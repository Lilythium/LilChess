import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { buildApp } from "../app.js";
import { config } from "../config.js";
import { closeDb, getDb, openDb } from "../db/connection.js";
import { topPlayers } from "../leaderboard/queries.js";
import { findResetTargets } from "../auth/passwordReset.js";
import { registerUser } from "../testing/helpers.js";
import { subscribeUser, unsubscribeUser } from "../ws/hub.js";

describe("admin: creating and disabling accounts", () => {
  let app: FastifyInstance;
  let admin: string;
  let player: string;
  const registration = config.registration;

  const idOf = (username: string) => getDb().prepare(`SELECT id FROM users WHERE username = ?`).pluck().get(username) as number;
  const post = (sid: string, url: string, payload?: unknown) =>
    app.inject({ method: "POST", url, cookies: { sessionId: sid }, payload: payload as object });
  const login = (username: string, password = "hunter22!") =>
    app.inject({ method: "POST", url: "/api/login", payload: { username, password } });
  const audit = async () =>
    ((await app.inject({ method: "GET", url: "/api/admin/audit", cookies: { sessionId: admin } })).json().entries as
      { action: string; target: string; details: string }[]);

  beforeEach(async () => {
    openDb(":memory:");
    app = await buildApp();
    admin = await registerUser(app, "admin");
    player = await registerUser(app, "player");
    getDb().prepare(`UPDATE users SET is_admin = 1 WHERE username = 'admin'`).run();
  });
  afterEach(async () => {
    config.registration = registration;
    await app.close();
    closeDb();
  });

  describe("creating users", () => {
    it("lets an admin create an account, and the person can log in with it", async () => {
      const res = await post(admin, "/api/admin/users", { username: "Newbie", password: "correct horse" });
      expect(res.statusCode).toBe(200);
      expect(res.json().user).toMatchObject({ username: "newbie", is_admin: 0, is_guest: 0 });
      expect((await login("newbie", "correct horse")).statusCode).toBe(200);
      expect(await audit()).toEqual([
        expect.objectContaining({ action: "user.create", target: "user:newbie", details: JSON.stringify({ userId: idOf("newbie"), isAdmin: false }) }),
      ]);
    });

    it("works when registration is closed, which is the point", async () => {
      config.registration = "closed";
      expect((await app.inject({ method: "POST", url: "/api/register", payload: { username: "walkin", password: "hunter22!" } })).statusCode).toBe(403);
      expect((await post(admin, "/api/admin/users", { username: "invited", password: "hunter22!" })).statusCode).toBe(200);
      expect((await login("invited")).statusCode).toBe(200);
    });

    it("can create another administrator", async () => {
      await post(admin, "/api/admin/users", { username: "second", password: "hunter22!", isAdmin: true });
      const me = await app.inject({ method: "GET", url: "/api/me", cookies: { sessionId: (await login("second")).cookies[0]!.value } });
      expect(me.json().user.is_admin).toBe(1);
    });

    it("applies the registration rules: reserved and invalid names, short passwords, duplicates", async () => {
      expect((await post(admin, "/api/admin/users", { username: "guest_abc", password: "hunter22!" })).statusCode).toBe(400);
      expect((await post(admin, "/api/admin/users", { username: "a b", password: "hunter22!" })).statusCode).toBe(400);
      expect((await post(admin, "/api/admin/users", { username: "fine", password: "short" })).statusCode).toBe(400);
      const dup = await post(admin, "/api/admin/users", { username: "PLAYER", password: "hunter22!" });
      expect(dup.statusCode).toBe(409);
      expect(dup.json().error).toBe("Username taken");
      expect(await audit()).toEqual([]); // nothing happened, nothing logged
    });

    it("is for administrators only", async () => {
      expect((await post(player, "/api/admin/users", { username: "sneaky", password: "hunter22!" })).statusCode).toBe(403);
    });
  });

  describe("disabling users", () => {
    it("blocks login, ends sessions, and says so only to someone with the right password", async () => {
      const res = await post(admin, `/api/admin/users/${idOf("player")}/disable`);
      expect(res.statusCode).toBe(200);

      expect((await app.inject({ method: "GET", url: "/api/me", cookies: { sessionId: player } })).statusCode).toBe(401);
      const right = await login("player");
      expect(right.statusCode).toBe(403);
      expect(right.json().error).toMatch(/disabled/);
      expect(right.cookies).toEqual([]);
      const wrong = await login("player", "not the password");
      expect(wrong.statusCode).toBe(401);
      expect(wrong.json().error).toBe("Invalid credentials");
    });

    it("takes the account out of circulation: challenges, open tournaments, direct challenges, rankings", async () => {
      const playerId = idOf("player");
      const challenge = await post(player, "/api/challenges", { mode: "live", initialMs: 300_000, incrementMs: 0 });
      const tournament = await post(player, "/api/tournaments", { name: "Cup", mode: "correspondence", daysPerMove: 2, maxPlayers: 4 });
      expect(tournament.statusCode).toBe(200);
      getDb().prepare(`INSERT INTO ratings (user_id, variant, rating, rd, volatility, games, last_game_at) VALUES (?, 'standard', 1700, 60, 0.06, 20, ?)`)
        .run(playerId, Date.now());
      expect(topPlayers("standard", { minGames: 5, inactiveDays: 30 }).players.map((p) => p.username)).toEqual(["player"]);

      const res = await post(admin, `/api/admin/users/${playerId}/disable`);
      expect(res.json()).toEqual({ ok: true, activeGames: 0 });

      expect(getDb().prepare(`SELECT COUNT(*) FROM challenges WHERE id = ?`).pluck().get(challenge.json().challengeId)).toBe(0);
      expect(getDb().prepare(`SELECT COUNT(*) FROM tournament_participants WHERE user_id = ?`).pluck().get(playerId)).toBe(0);
      expect(topPlayers("standard", { minGames: 5, inactiveDays: 30 }).players).toEqual([]);

      const other = await registerUser(app, "other");
      const direct = await post(other, "/api/challenges", { mode: "live", initialMs: 300_000, incrementMs: 0, toUsername: "player" });
      expect(direct.statusCode).toBe(404);
    });

    it("keeps history and leaves running games alone, but reports them", async () => {
      const other = await registerUser(app, "other");
      const created = await post(player, "/api/challenges", { mode: "live", initialMs: 300_000, incrementMs: 0, colorPref: "white" });
      await post(other, `/api/challenges/${created.json().challengeId}/accept`);
      const res = await post(admin, `/api/admin/users/${idOf("player")}/disable`);
      expect(res.json().activeGames).toBe(1);
      expect(getDb().prepare(`SELECT COUNT(*) FROM games WHERE status = 'started'`).pluck().get()).toBe(1);
    });

    it("closes the account's live connections", async () => {
      const socket = { close: vi.fn() } as unknown as WebSocket;
      subscribeUser(idOf("player"), socket);
      await post(admin, `/api/admin/users/${idOf("player")}/disable`);
      expect(socket.close).toHaveBeenCalledWith(4003, "account disabled");
      unsubscribeUser(idOf("player"), socket);
    });

    it("stops password-reset mail going to a disabled account", async () => {
      getDb().prepare(`UPDATE users SET email = 'p@example.com' WHERE username = 'player'`).run();
      expect(findResetTargets("player")).toHaveLength(1);
      await post(admin, `/api/admin/users/${idOf("player")}/disable`);
      expect(findResetTargets("player")).toEqual([]);
      expect(findResetTargets("p@example.com")).toEqual([]);
    });

    it("can be undone, and logs both steps with what was cleaned up", async () => {
      const playerId = idOf("player");
      await post(admin, `/api/admin/users/${playerId}/disable`);
      expect((await post(admin, `/api/admin/users/${playerId}/enable`)).statusCode).toBe(200);
      expect((await login("player")).statusCode).toBe(200);
      const log = await audit();
      expect(log.map((e) => [e.action, e.target])).toEqual([["user.enable", "user:player"], ["user.disable", "user:player"]]);
      expect(JSON.parse(log[1]!.details)).toEqual({ userId: playerId, sessions: 1, challenges: 0, tournaments: 0 });
    });

    it("refuses nonsense: yourself, twice, unknown ids, enabling an active account", async () => {
      expect((await post(admin, `/api/admin/users/${idOf("admin")}/disable`)).statusCode).toBe(409);
      expect((await post(admin, `/api/admin/users/${idOf("player")}/enable`)).statusCode).toBe(409);
      await post(admin, `/api/admin/users/${idOf("player")}/disable`);
      expect((await post(admin, `/api/admin/users/${idOf("player")}/disable`)).statusCode).toBe(409);
      expect((await post(admin, "/api/admin/users/9999/disable")).statusCode).toBe(404);
      expect((await post(player, `/api/admin/users/${idOf("admin")}/disable`)).statusCode).toBe(401); // their session is gone
    });

    it("lets one admin disable another, but nobody can lock themselves out, so one always remains", async () => {
      const second = await post(admin, "/api/admin/users", { username: "second", password: "hunter22!", isAdmin: true });
      const secondId = second.json().user.id as number;
      const secondSid = (await login("second")).cookies[0]!.value;

      expect((await post(secondSid, `/api/admin/users/${idOf("admin")}/disable`)).statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: "/api/admin/stats", cookies: { sessionId: admin } })).statusCode).toBe(401);

      // The remaining admin can neither disable nor demote themselves.
      expect((await post(secondSid, `/api/admin/users/${secondId}/disable`)).statusCode).toBe(409);
      const demote = await app.inject({
        method: "PATCH", url: `/api/admin/users/${secondId}`, cookies: { sessionId: secondSid }, payload: { isAdmin: false },
      });
      expect(demote.statusCode).toBe(409);
      expect(getDb().prepare(`SELECT COUNT(*) FROM users WHERE is_admin = 1 AND disabled_at IS NULL`).pluck().get()).toBe(1);
    });

    it("won't make a disabled account an administrator", async () => {
      await post(admin, `/api/admin/users/${idOf("player")}/disable`);
      const res = await app.inject({
        method: "PATCH", url: `/api/admin/users/${idOf("player")}`, cookies: { sessionId: admin }, payload: { isAdmin: true },
      });
      expect(res.statusCode).toBe(409);
    });
  });
});