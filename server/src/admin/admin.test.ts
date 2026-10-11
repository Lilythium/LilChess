import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { closeDb, getDb, openDb } from "../db/connection.js";
import { registerUser, startGame } from "../testing/helpers.js";
import { createGame } from "@lilchess/shared";
import { insertGame } from "../db/repositories/games.js";

describe("admin routes", () => {
  let app: FastifyInstance;
  let admin: string;
  let player: string;

  beforeEach(async () => {
    openDb(":memory:");
    app = await buildApp();
    admin = await registerUser(app, "admin");
    player = await registerUser(app, "player");
    getDb().prepare(`UPDATE users SET is_admin = 1 WHERE username = 'admin'`).run();
  });

  afterEach(async () => {
    await app.close();
    closeDb();
  });

  it("rejects non-admins and exposes basic server statistics to admins", async () => {
    const denied = await app.inject({ method: "GET", url: "/api/admin/stats", cookies: { sessionId: player } });
    expect(denied.statusCode).toBe(403);

    const stats = await app.inject({ method: "GET", url: "/api/admin/stats", cookies: { sessionId: admin } });
    expect(stats.statusCode).toBe(200);
    expect(stats.json().stats).toMatchObject({ users: 2, registeredUsers: 2, activeGames: 0 });

    const audit = await app.inject({ method: "GET", url: "/api/admin/audit", cookies: { sessionId: admin } });
    expect(audit.json().entries.some((entry: { action: string }) => entry.action === "GET /api/admin/stats")).toBe(true);
  });

  it("manages user access, invitations and tournaments, and terminates active games", async () => {
    const challenge = await app.inject({
      method: "POST", url: "/api/challenges", cookies: { sessionId: player },
      payload: { mode: "live", initialMs: 300_000, incrementMs: 0 },
    });
    const challengeId = challenge.json().challengeId as string;
    const tournament = await app.inject({
      method: "POST", url: "/api/tournaments", cookies: { sessionId: player },
      payload: { name: "Admin Cup", mode: "correspondence", daysPerMove: 2, maxPlayers: 4 },
    });
    const gameId = await startGame(app, admin, player);

    const playerId = (getDb().prepare(`SELECT id FROM users WHERE username = 'player'`).get() as { id: number }).id;
    const role = await app.inject({
      method: "PATCH", url: `/api/admin/users/${playerId}`, cookies: { sessionId: admin }, payload: { isAdmin: true },
    });
    expect(role.statusCode).toBe(200);

    const revoked = await app.inject({
      method: "DELETE", url: `/api/admin/invitations/${challengeId}`, cookies: { sessionId: admin },
    });
    expect(revoked.statusCode).toBe(200);

    const cancelled = await app.inject({
      method: "POST", url: `/api/admin/tournaments/${tournament.json().tournamentId}/cancel`, cookies: { sessionId: admin },
    });
    expect(cancelled.statusCode).toBe(200);

    const firstMove = await app.inject({
      method: "POST", url: `/api/games/${gameId}/move`, cookies: { sessionId: admin }, payload: { ply: 0, uci: "e2e4" },
    });
    expect(firstMove.statusCode).toBe(200);
    const secondMove = await app.inject({
      method: "POST", url: `/api/games/${gameId}/move`, cookies: { sessionId: player }, payload: { ply: 1, uci: "e7e5" },
    });
    expect(secondMove.statusCode).toBe(200);

    const terminated = await app.inject({
      method: "POST", url: `/api/admin/games/${gameId}/terminate`, cookies: { sessionId: admin },
    });
    expect(terminated.statusCode).toBe(200);
    expect((getDb().prepare(`SELECT status, termination FROM games WHERE id = ?`).get(gameId) as { status: string; termination: string }))
      .toEqual({ status: "aborted", termination: "abort" });

    const sessions = await app.inject({
      method: "POST", url: `/api/admin/users/${playerId}/revoke-sessions`, cookies: { sessionId: admin },
    });
    expect(sessions.json().revoked).toBe(1);
    expect((await app.inject({ method: "GET", url: "/api/me", cookies: { sessionId: player } })).statusCode).toBe(401);

    const audit = await app.inject({ method: "GET", url: "/api/admin/audit", cookies: { sessionId: admin } });
    expect(audit.json().entries.map((entry: { target: string }) => entry.target)).toEqual(expect.arrayContaining([
      `/api/admin/users/${playerId}`,
      `/api/admin/users/${playerId}/revoke-sessions`,
      `/api/admin/invitations/${challengeId}`,
      `/api/admin/tournaments/${tournament.json().tournamentId}/cancel`,
      `/api/admin/games/${gameId}/terminate`,
    ]));
  });

  it("purges only unused guests and preserves guests with game history", async () => {
    const db = getDb();
    const adminId = (db.prepare(`SELECT id FROM users WHERE username = 'admin'`).get() as { id: number }).id;
    const insertGuest = db.prepare(`INSERT INTO users (username, password_hash, created_at, is_guest) VALUES (?, '!', ?, 1)`);
    insertGuest.run("guest_unused", Date.now());
    const historyGuest = Number(insertGuest.run("guest_history", Date.now()).lastInsertRowid);
    const activeGuest = Number(insertGuest.run("guest_active", Date.now()).lastInsertRowid);
    const game = createGame({ clock: { mode: "live", initialMs: 60_000, incrementMs: 0 }, now: Date.now() });
    insertGame("guest-history-game", adminId, historyGuest, game);
    db.prepare(`UPDATE games SET status = 'finished', result = '1-0', termination = 'resignation', ended_at = ? WHERE id = ?`)
      .run(Date.now(), "guest-history-game");
    insertGame("guest-active-game", adminId, activeGuest, game);

    const response = await app.inject({
      method: "POST", url: "/api/admin/users/purge-guests", cookies: { sessionId: admin },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().deleted).toBe(1);
    expect(db.prepare(`SELECT username FROM users WHERE is_guest = 1 ORDER BY username`).all()).toEqual([
      { username: "guest_active" }, { username: "guest_history" },
    ]);
  });
});