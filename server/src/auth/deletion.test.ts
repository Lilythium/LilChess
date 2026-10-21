import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { closeDb, getDb, openDb } from "../db/connection.js";
import { registerUser, startGame } from "../testing/helpers.js";

const PASSWORD = "hunter22!";

describe("account deletion", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    openDb(":memory:");
    app = await buildApp();
  });
  afterEach(async () => {
    await app.close();
    closeDb();
  });

  const idOf = (name: string) => getDb().prepare(`SELECT id FROM users WHERE username = ?`).pluck().get(name) as number;
  const remove = (sid: string, payload: Record<string, unknown> = { password: PASSWORD }) =>
    app.inject({ method: "POST", url: "/api/me/delete", cookies: { sessionId: sid }, payload });
  const me = (sid: string) => app.inject({ method: "GET", url: "/api/me", cookies: { sessionId: sid } });
  const count = (sql: string, ...params: unknown[]) => getDb().prepare(sql).pluck().get(...params) as number;

  /** alice (white) and bob play one game that alice resigns, so it is finished and both keep the record. */
  async function finishedGame() {
    const alice = await registerUser(app, "alice");
    const bob = await registerUser(app, "bob");
    const gameId = await startGame(app, alice, bob);
    expect((await app.inject({ method: "POST", url: `/api/games/${gameId}/resign`, cookies: { sessionId: alice } })).statusCode).toBe(200);
    return { alice, bob, gameId };
  }

  it("needs a signed-in session and the right password, and changes nothing otherwise", async () => {
    const alice = await registerUser(app, "alice");
    expect((await app.inject({ method: "POST", url: "/api/me/delete", payload: { password: PASSWORD } })).statusCode).toBe(401);

    for (const payload of [{}, { password: "wrong-password" }]) {
      const res = await remove(alice, payload);
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe("Incorrect password");
    }
    expect((await me(alice)).statusCode).toBe(200);
    expect(count(`SELECT COUNT(*) FROM users WHERE username = 'alice' AND deleted_at IS NULL`)).toBe(1);
  });

  it("anonymizes the account, ends every session, and removes personal data", async () => {
    const { alice, bob, gameId } = await finishedGame();
    const id = idOf("alice");
    const db = getDb();
    db.prepare(`UPDATE users SET email = 'a@example.com', discord_id = '123456789012345678', unsubscribe_token = 'tok' WHERE id = ?`).run(id);
    db.prepare(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('other-device', ?, ?)`).run(id, Date.now() + 1e9);
    db.prepare(`INSERT INTO ratings (user_id, variant, rating, rd, volatility, games) VALUES (?, 'standard', 1500, 200, 0.06, 1), (?, 'standard', 1500, 200, 0.06, 1)`).run(id, idOf("bob"));
    db.prepare(`INSERT INTO rating_history (game_id, user_id, variant, opponent_id, opponent_rating, score, rating_before, rd_before, rating_after, rd_after, volatility_after, created_at)
                VALUES (?, ?, 'standard', ?, 1500, 0, 1500, 200, 1480, 190, 0.06, 1), (?, ?, 'standard', ?, 1500, 1, 1500, 200, 1520, 190, 0.06, 1)`)
      .run(gameId, id, idOf("bob"), gameId, idOf("bob"), id);
    db.prepare(`INSERT INTO imported_games (id, owner_id, white_name, black_name, result, initial_fen, fen, ply, content_hash, created_at)
                VALUES ('imp1', ?, 'x', 'y', '1-0', 'f', 'f', 0, 'h', 1)`).run(id);
    db.prepare(`INSERT INTO notification_prefs (user_id, kind, enabled) VALUES (?, 'your_turn', 1)`).run(id);
    db.prepare(`INSERT INTO notification_prefs_discord (user_id, kind, enabled) VALUES (?, 'your_turn', 1)`).run(id);
    db.prepare(`INSERT INTO notification_log (user_id, dedup_key, kind, created_at) VALUES (?, 'k', 'your_turn', 1)`).run(id);
    db.prepare(`INSERT INTO password_resets (token_hash, user_id, created_at, expires_at) VALUES ('r', ?, 1, ?)`).run(id, Date.now() + 1e9);
    db.prepare(`INSERT INTO challenges (id, from_user, mode, initial_ms, increment_ms, created_at, expires_at) VALUES ('open1', ?, 'live', 60000, 0, 1, ?)`).run(id, Date.now() + 1e9);

    const res = await remove(alice);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    // signed out everywhere, and cannot sign back in
    expect((await me(alice)).statusCode).toBe(401);
    expect(count(`SELECT COUNT(*) FROM sessions WHERE user_id = ?`, id)).toBe(0);
    expect((await app.inject({ method: "POST", url: "/api/login", payload: { username: "alice", password: PASSWORD } })).statusCode).toBe(401);

    // nothing anywhere still points at something that no longer exists
    expect(db.prepare(`PRAGMA foreign_key_check`).all()).toEqual([]);

    // the row is an anonymous tombstone
    const row = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as Record<string, unknown>;
    expect(row.username).toMatch(/^deleted_[0-9a-f]{8}$/);
    expect(row).toMatchObject({ password_hash: "!", email: null, discord_id: null, unsubscribe_token: null });
    expect(row.deleted_at).toEqual(row.disabled_at);

    // personal data is gone ...
    for (const [table, column] of [
      ["ratings", "user_id"], ["rating_history", "user_id"], ["notification_prefs", "user_id"], ["notification_prefs_discord", "user_id"],
      ["notification_log", "user_id"], ["password_resets", "user_id"], ["imported_games", "owner_id"],
    ]) {
      expect(count(`SELECT COUNT(*) FROM ${table} WHERE ${column} = ?`, id), table).toBe(0);
    }
    expect(count(`SELECT COUNT(*) FROM challenges WHERE from_user = ?`, id)).toBe(0);

    // ... but the other player keeps their game, rating and rating history
    expect(count(`SELECT COUNT(*) FROM games WHERE id = ? AND white_id = ?`, gameId, id)).toBe(1);
    expect(count(`SELECT COUNT(*) FROM ratings WHERE user_id = ?`, idOf("bob"))).toBe(1);
    expect(count(`SELECT COUNT(*) FROM rating_history WHERE user_id = ?`, idOf("bob"))).toBe(1);
    const game = await app.inject({ method: "GET", url: `/api/games/${gameId}`, cookies: { sessionId: bob } });
    expect(game.statusCode).toBe(200);
    expect(JSON.stringify(game.json())).toContain(row.username as string);
    expect(JSON.stringify(game.json())).not.toContain("alice");
  });

  it("frees the username, hides the old profile, and reserves the deleted-name shape", async () => {
    const { alice, bob } = await finishedGame();
    expect((await remove(alice)).statusCode).toBe(200);

    expect((await app.inject({ method: "GET", url: "/api/users/alice", cookies: { sessionId: bob } })).statusCode).toBe(404);
    const again = await app.inject({ method: "POST", url: "/api/register", payload: { username: "alice", password: PASSWORD } });
    expect(again.statusCode).toBe(200);
    expect(idOf("alice")).not.toBe(count(`SELECT id FROM users WHERE deleted_at IS NOT NULL`));

    const reserved = await app.inject({ method: "POST", url: "/api/register", payload: { username: "deleted_0123abcd", password: PASSWORD } });
    expect(reserved.statusCode).toBe(409);
    expect(reserved.json().error).toBe("Username taken");
  });

  it("works for a guest without a password", async () => {
    const host = await registerUser(app, "host");
    const link = await app.inject({
      method: "POST", url: "/api/challenges", cookies: { sessionId: host },
      payload: { mode: "live", initialMs: 300_000, incrementMs: 0, link: true },
    });
    const guest = await app.inject({ method: "POST", url: "/api/guest", payload: { challengeId: link.json().challengeId } });
    const sid = guest.cookies.find((c) => c.name === "sessionId")!.value;

    const res = await remove(sid, {});
    expect(res.statusCode).toBe(200);
    expect((await me(sid)).statusCode).toBe(401);
    expect(count(`SELECT COUNT(*) FROM users WHERE id = ? AND deleted_at IS NOT NULL`, guest.json().user.id)).toBe(1);
  });

  it("works for a native bearer session and sets no cookie", async () => {
    await registerUser(app, "alice");
    const login = await app.inject({ method: "POST", url: "/api/native/login", payload: { username: "alice", password: PASSWORD } });
    const headers = { authorization: `Bearer ${login.json().sessionToken}` };
    const res = await app.inject({ method: "POST", url: "/api/me/delete", headers, payload: { password: PASSWORD } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect((await app.inject({ method: "GET", url: "/api/me", headers })).statusCode).toBe(401);
  });

  it("refuses while a game is in progress, with the reason, and keeps the account", async () => {
    const alice = await registerUser(app, "alice");
    const bob = await registerUser(app, "bob");
    const gameId = await startGame(app, alice, bob);

    const res = await remove(alice);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/1 game in progress.*resign it first/);
    expect((await me(alice)).statusCode).toBe(200);

    await app.inject({ method: "POST", url: `/api/games/${gameId}/resign`, cookies: { sessionId: alice } });
    expect((await remove(alice)).statusCode).toBe(200);
  });

  it("refuses for administrators", async () => {
    const alice = await registerUser(app, "alice");
    getDb().prepare(`UPDATE users SET is_admin = 1 WHERE username = 'alice'`).run();
    const res = await remove(alice);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/Administrators can't delete their own account/);
  });

  it("refuses while hosting or playing in a running tournament; leaves an open one", async () => {
    const alice = await registerUser(app, "alice");
    await registerUser(app, "bob");
    const db = getDb();
    const tournament = (id: string, host: number, status: string) =>
      db.prepare(`INSERT INTO tournaments (id, created_by, name, mode, initial_ms, increment_ms, max_players, created_at, status)
                  VALUES (?, ?, 'T', 'live', 60000, 0, 8, 1, ?)`).run(id, host, status);

    tournament("hosted", idOf("alice"), "running");
    expect((await remove(alice)).json().error).toMatch(/running a tournament or simul/);
    db.prepare(`UPDATE tournaments SET status = 'completed' WHERE id = 'hosted'`).run();

    tournament("bobs-running", idOf("bob"), "running");
    db.prepare(`INSERT INTO tournament_participants (tournament_id, user_id, joined_at) VALUES ('bobs-running', ?, 1)`).run(idOf("alice"));
    expect((await remove(alice)).json().error).toMatch(/taking part in a tournament that is running/);
    db.prepare(`UPDATE tournaments SET status = 'completed' WHERE id = 'bobs-running'`).run();

    tournament("bobs-open", idOf("bob"), "open");
    db.prepare(`INSERT INTO tournament_participants (tournament_id, user_id, joined_at) VALUES ('bobs-open', ?, 1)`).run(idOf("alice"));
    expect((await remove(alice)).statusCode).toBe(200);
    expect(count(`SELECT COUNT(*) FROM tournament_participants WHERE tournament_id = 'bobs-open'`)).toBe(0);
    // results of a finished tournament keep their row, now anonymous
    expect(count(`SELECT COUNT(*) FROM tournament_participants WHERE tournament_id = 'bobs-running'`)).toBe(1);
  });

  it("does not list deleted accounts to administrators and cannot be repeated", async () => {
    const alice = await registerUser(app, "alice");
    const admin = await registerUser(app, "root");
    getDb().prepare(`UPDATE users SET is_admin = 1 WHERE username = 'root'`).run();
    expect((await remove(alice)).statusCode).toBe(200);

    const list = await app.inject({ method: "GET", url: "/api/admin/users", cookies: { sessionId: admin } });
    expect((list.json().users as { username: string }[]).map((u) => u.username)).toEqual(["root"]);
    expect((await remove(alice)).statusCode).toBe(401);
  });
});
