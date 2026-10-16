import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { config } from "../config.js";
import { closeDb, getDb, openDb } from "../db/connection.js";
import { hashSessionToken } from "../auth/crypto.js";
import { ADMIN_RESET_TTL_MS, createResetToken } from "../auth/passwordReset.js";
import { createGuest } from "../auth/queries.js";
import { registerUser } from "../testing/helpers.js";

describe("admin: password reset links", () => {
  let app: FastifyInstance;
  let admin: string;
  let player: string;

  const idOf = (username: string) => getDb().prepare(`SELECT id FROM users WHERE username = ?`).pluck().get(username) as number;
  const post = (sid: string | undefined, url: string, payload?: object) =>
    app.inject({ method: "POST", url, cookies: sid ? { sessionId: sid } : undefined, payload });
  const tokenOf = (link: string) => link.split("/reset/")[1]!;
  const issue = (username = "player") => post(admin, `/api/admin/users/${idOf(username)}/reset-link`);

  beforeEach(async () => {
    openDb(":memory:");
    app = await buildApp();
    admin = await registerUser(app, "admin");
    player = await registerUser(app, "player");
    getDb().prepare(`UPDATE users SET is_admin = 1 WHERE username = 'admin'`).run();
    config.baseOrigin = "https://chess.test";
  });
  afterEach(async () => {
    config.baseOrigin = undefined;
    await app.close();
    closeDb();
  });

  it("gives the admin a working link for an account that has no email", async () => {
    const res = await issue();
    expect(res.statusCode).toBe(200);
    const { link, expiresAt, username } = res.json();
    expect(username).toBe("player");
    expect(link).toMatch(/^https:\/\/chess\.test\/#\/reset\/[0-9a-f]{64}$/);
    expect(expiresAt).toBeGreaterThan(Date.now() + ADMIN_RESET_TTL_MS - 60_000);

    const reset = await post(undefined, "/api/password/reset", { token: tokenOf(link), password: "brand new pass" });
    expect(reset.statusCode).toBe(200);
    expect((await post(undefined, "/api/login", { username: "player", password: "brand new pass" })).statusCode).toBe(200);
    // the old session was signed out and the link is single-use
    expect((await app.inject({ method: "GET", url: "/api/me", cookies: { sessionId: player } })).statusCode).toBe(401);
    expect((await post(undefined, "/api/password/reset", { token: tokenOf(link), password: "another pass 1" })).statusCode).toBe(400);
  });

  it("stores only a hash of the token and keeps the token out of the audit log", async () => {
    const token = tokenOf((await issue()).json().link);
    const stored = getDb().prepare(`SELECT token_hash FROM password_resets`).pluck().all() as string[];
    expect(stored).toEqual([hashSessionToken(token)]);
    const entries = (await app.inject({ method: "GET", url: "/api/admin/audit", cookies: { sessionId: admin } })).json().entries as
      { action: string; target: string; details: string }[];
    expect(entries).toEqual([expect.objectContaining({ action: "user.reset_link", target: "user:player" })]);
    expect(JSON.stringify(entries)).not.toContain(token);
  });

  it("ignores the emailed-link cooldown and replaces any older link", async () => {
    createResetToken(idOf("player")); // a user-requested link just went out
    const first = tokenOf((await issue()).json().link);
    const second = tokenOf((await issue()).json().link);
    expect(first).not.toBe(second);
    expect(getDb().prepare(`SELECT COUNT(*) FROM password_resets`).pluck().get()).toBe(1);
    expect((await post(undefined, "/api/password/reset", { token: first, password: "brand new pass" })).statusCode).toBe(400);
    expect((await post(undefined, "/api/password/reset", { token: second, password: "brand new pass" })).statusCode).toBe(200);
  });

  it("falls back to the request's own origin when BASE_URL isn't set", async () => {
    config.baseOrigin = undefined;
    expect((await issue()).json().link).toMatch(/^https?:\/\/[^/]+\/#\/reset\/[0-9a-f]{64}$/);
  });

  it("refuses guests, disabled accounts and unknown users", async () => {
    const guestId = createGuest().id;
    expect((await post(admin, `/api/admin/users/${guestId}/reset-link`)).statusCode).toBe(409);

    getDb().prepare(`UPDATE users SET disabled_at = 1 WHERE username = 'player'`).run();
    expect((await issue()).statusCode).toBe(409);
    expect((await post(admin, `/api/admin/users/99999/reset-link`)).statusCode).toBe(404);
    expect(getDb().prepare(`SELECT COUNT(*) FROM password_resets`).pluck().get()).toBe(0);
  });

  it("is admin-only", async () => {
    expect((await post(player, `/api/admin/users/${idOf("admin")}/reset-link`)).statusCode).toBe(403);
    expect((await post(undefined, `/api/admin/users/${idOf("admin")}/reset-link`)).statusCode).toBe(401);
  });
});
