import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { closeDb, getDb, openDb } from "../db/connection.js";
import { hashSessionToken } from "./crypto.js";

// Mobile Phase 9: native session lifecycle (login, registration, logout, revocation, expiry).
// Each case checks the part of the contract the mobile client relies on: a dead session is a plain 401
// with no Set-Cookie (so the app stops retrying), and one device logging out never affects another.

describe("native session lifecycle", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    openDb(":memory:");
    app = await buildApp();
  });
  afterEach(async () => {
    await app.close();
    closeDb();
  });

  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const register = async (username: string) => {
    const res = await app.inject({
      method: "POST",
      url: "/api/native/register",
      payload: { username, password: "hunter22!" },
    });
    expect(res.statusCode).toBe(200);
    return res.json().sessionToken as string;
  };
  const login = async (username: string) => {
    const res = await app.inject({
      method: "POST",
      url: "/api/native/login",
      payload: { username, password: "hunter22!" },
    });
    expect(res.statusCode).toBe(200);
    return res.json().sessionToken as string;
  };
  const me = (token: string) => app.inject({ method: "GET", url: "/api/me", headers: bearer(token) });

  it("registers, authenticates, and sets no cookie", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/native/register",
      payload: { username: "alice", password: "hunter22!" },
    });
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(res.json().sessionToken).toMatch(/^[a-f\d]{64}$/);
    expect((await me(res.json().sessionToken)).json().user.username).toBe("alice");
  });

  it("logout revokes only the current session and is safe to repeat", async () => {
    await register("alice");
    const phone = await login("alice");
    const tablet = await login("alice");
    expect(phone).not.toBe(tablet);

    const first = await app.inject({ method: "POST", url: "/api/logout", headers: bearer(phone) });
    expect(first.statusCode).toBe(200);
    expect(first.headers["set-cookie"]).toBeUndefined();

    const revoked = await me(phone);
    expect(revoked.statusCode).toBe(401);
    expect(revoked.headers["set-cookie"]).toBeUndefined();
    expect((await me(tablet)).statusCode).toBe(200);

    const again = await app.inject({ method: "POST", url: "/api/logout", headers: bearer(phone) });
    expect(again.statusCode).toBe(200);
  });

  it("answers an expired session with a plain 401 and no Set-Cookie", async () => {
    const token = await register("alice");
    expect((await me(token)).statusCode).toBe(200);

    getDb()
      .prepare(`UPDATE sessions SET expires_at = ? WHERE token_hash = ?`)
      .run(Date.now() - 1_000, hashSessionToken(token));

    const res = await me(token);
    expect(res.statusCode).toBe(401);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("rejects a session whose account was disabled", async () => {
    const token = await register("alice");
    getDb().prepare(`UPDATE users SET disabled_at = ? WHERE username = 'alice'`).run(Date.now());
    expect((await me(token)).statusCode).toBe(401);
  });

  it.each([
    ["too short", "Bearer abc"],
    ["wrong scheme", `Basic ${"a".repeat(64)}`],
    ["not hex", `Bearer ${"z".repeat(64)}`],
    ["empty token", "Bearer "],
  ])("rejects a malformed Authorization header (%s) without falling back to a cookie", async (_label, header) => {
    // A valid web cookie is present, so a fallback would wrongly authenticate this request.
    const webLogin = await app.inject({
      method: "POST",
      url: "/api/register",
      payload: { username: "webuser", password: "hunter22!" },
    });
    const cookie = webLogin.cookies.find((c) => c.name === "sessionId")!.value;

    const res = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { authorization: header },
      cookies: { sessionId: cookie },
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("a wrong password or unknown user yields 401 and never a token", async () => {
    await register("alice");
    for (const payload of [
      { username: "alice", password: "wrong-password" },
      { username: "nobody", password: "hunter22!" },
    ]) {
      const res = await app.inject({ method: "POST", url: "/api/native/login", payload });
      expect(res.statusCode).toBe(401);
      expect(res.body).not.toMatch(/sessionToken/);
      expect(res.headers["set-cookie"]).toBeUndefined();
    }
  });

  it("a revoked bearer session cannot obtain a WebSocket ticket", async () => {
    const token = await register("alice");
    await app.inject({ method: "POST", url: "/api/logout", headers: bearer(token) });
    const res = await app.inject({ method: "POST", url: "/api/native/ws-ticket", headers: bearer(token) });
    expect(res.statusCode).toBe(401);
  });
});
