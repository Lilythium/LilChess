import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { closeDb, getDb, openDb } from "../db/connection.js";
import { registerUser } from "../testing/helpers.js";

describe("tournament lifecycle", () => {
  let app: FastifyInstance;
  let alice: string;
  let bob: string;
  let carol: string;

  beforeEach(async () => {
    openDb(":memory:");
    app = await buildApp();
    alice = await registerUser(app, "alice");
    bob = await registerUser(app, "bob");
    carol = await registerUser(app, "carol");
  });

  afterEach(async () => {
    await app.close();
    closeDb();
  });

  it("registers players, generates each round-robin pairing, and updates standings", async () => {
    const created = await app.inject({
      method: "POST", url: "/api/tournaments", cookies: { sessionId: alice },
      payload: { name: "Friday Swiss", mode: "live", initialMs: 300_000, incrementMs: 2, maxPlayers: 4 },
    });
    expect(created.statusCode).toBe(200);
    const id = created.json().tournamentId as string;

    const bobJoin = await app.inject({ method: "POST", url: `/api/tournaments/${id}/join`, cookies: { sessionId: bob } });
    expect(bobJoin.statusCode, bobJoin.body).toBe(200);
    expect((await app.inject({ method: "POST", url: `/api/tournaments/${id}/join`, cookies: { sessionId: carol } })).statusCode).toBe(200);
    const started = await app.inject({ method: "POST", url: `/api/tournaments/${id}/start`, cookies: { sessionId: alice } });
    expect(started.statusCode).toBe(200);
    expect(started.json().gameCount).toBe(3);

    const gameRows = getDb().prepare(`
      SELECT g.id, g.white_id, g.black_id, g.rated, g.mode, tg.round_number
      FROM tournament_games tg JOIN games g ON g.id = tg.game_id WHERE tg.tournament_id = ?
      ORDER BY tg.round_number
    `).all(id) as { id: string; white_id: number; black_id: number; rated: number; mode: string; round_number: number }[];
    expect(new Set(gameRows.map((g) => [g.white_id, g.black_id].sort().join(":"))).size).toBe(3);
    expect(gameRows.every((g) => g.rated === 0 && g.mode === "live")).toBe(true);
    expect(gameRows.map((g) => g.round_number)).toEqual([1, 2, 3]);
    const tournamentList = await app.inject({ method: "GET", url: "/api/tournaments", cookies: { sessionId: alice } });
    expect(gameRows.map((g) => g.id)).toContain(tournamentList.json().tournaments[0].nextGameId);

    const sessionsByUsername = { alice, bob, carol };
    for (const game of gameRows) {
      const white = getDb().prepare(`SELECT username FROM users WHERE id = ?`).get(game.white_id) as { username: keyof typeof sessionsByUsername };
      const ended = await app.inject({
        method: "POST", url: `/api/games/${game.id}/resign`,
        cookies: { sessionId: sessionsByUsername[white.username] },
      });
      expect(ended.statusCode).toBe(200);
    }
    const list = await app.inject({ method: "GET", url: "/api/tournaments", cookies: { sessionId: alice } });
    expect(list.json().tournaments[0].status).toBe("completed");
    const detail = await app.inject({ method: "GET", url: `/api/tournaments/${id}`, cookies: { sessionId: alice } });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().tournament.status).toBe("completed");
    expect(detail.json().standings.reduce((total: number, row: { points: number }) => total + row.points, 0)).toBe(3);
  });

  it("rejects registration after start and prevents non-organizers starting", async () => {
    const created = await app.inject({
      method: "POST", url: "/api/tournaments", cookies: { sessionId: alice },
      payload: { name: "Quick Cup", mode: "correspondence", daysPerMove: 2, maxPlayers: 3 },
    });
    const id = created.json().tournamentId as string;
    await app.inject({ method: "POST", url: `/api/tournaments/${id}/join`, cookies: { sessionId: bob } });
    expect((await app.inject({ method: "POST", url: `/api/tournaments/${id}/start`, cookies: { sessionId: bob } })).statusCode).toBe(403);
    await app.inject({ method: "POST", url: `/api/tournaments/${id}/start`, cookies: { sessionId: alice } });
    expect((await app.inject({ method: "POST", url: `/api/tournaments/${id}/join`, cookies: { sessionId: carol } })).statusCode).toBe(409);
  });
});