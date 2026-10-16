import { readFileSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { closeDb, getDb, openDb } from "../db/connection.js";
import { registerUser } from "../testing/helpers.js";
import { normalizeUsername } from "@lilchess/shared";

describe("normalizeUsername", () => {
  it("lowercases ASCII and trims", () => {
    expect(normalizeUsername("  AlIcE_1 ")).toBe("alice_1");
  });
  it("leaves non-ASCII alone, like SQLite NOCASE", () => {
    expect(normalizeUsername("Élodie")).toBe("Élodie");
  });
});

describe("username case handling", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    openDb(":memory:");
    app = await buildApp();
  });
  afterEach(async () => {
    await app.close();
    closeDb();
  });

  it("stores usernames lowercase", async () => {
    const sid = await registerUser(app, "Alice");
    const me = await app.inject({ method: "GET", url: "/api/me", cookies: { sessionId: sid } });
    expect(me.json().user.username).toBe("alice");
  });

  it("treats a differently-cased registration as taken", async () => {
    await registerUser(app, "alice");
    const res = await app.inject({
      method: "POST",
      url: "/api/register",
      payload: { username: "ALICE", password: "hunter22!" },
    });
    expect(res.statusCode).toBe(409);
  });

  it("logs in regardless of case", async () => {
    await registerUser(app, "alice");
    const res = await app.inject({
      method: "POST",
      url: "/api/login",
      payload: { username: "ALICE", password: "hunter22!" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.username).toBe("alice");
    expect(res.json().sessionToken).toBeUndefined();
  });

  it("issues a bearer session to native clients and revokes it on logout", async () => {
    await registerUser(app, "alice");
    const login = await app.inject({
      method: "POST",
      url: "/api/native/login",
      payload: { username: "alice", password: "hunter22!" },
    });

    expect(login.statusCode).toBe(200);
    expect(login.cookies).toHaveLength(0);
    const sessionToken = login.json().sessionToken as string;
    expect(sessionToken).toMatch(/^[a-f0-9]{64}$/);

    const me = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    expect(me.json().user.username).toBe("alice");

    const logout = await app.inject({
      method: "POST",
      url: "/api/logout",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    expect(logout.statusCode).toBe(200);

    const revoked = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    expect(revoked.statusCode).toBe(401);
  });

  it("returns a bearer session instead of a cookie for native registration", async () => {
    const registered = await app.inject({
      method: "POST",
      url: "/api/native/register",
      payload: { username: "native_user", password: "hunter22!" },
    });

    expect(registered.statusCode).toBe(200);
    expect(registered.cookies).toHaveLength(0);
    expect(registered.json().sessionToken).toMatch(/^[a-f0-9]{64}$/);
    const me = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { authorization: `Bearer ${registered.json().sessionToken}` },
    });
    expect(me.json().user.username).toBe("native_user");
  });

  it("does not fall back to a cookie when an Authorization header is supplied", async () => {
    const sid = await registerUser(app, "alice");
    const me = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { authorization: "Basic invalid", cookie: `sessionId=${sid}` },
    });
    expect(me.statusCode).toBe(401);
  });

  it("profile lookup ignores case", async () => {
    const alice = await registerUser(app, "alice");
    await registerUser(app, "bob");
    const res = await app.inject({ method: "GET", url: "/api/users/BOB", cookies: { sessionId: alice } });
    expect(res.statusCode).toBe(200);
    expect(res.json().profile.username).toBe("bob");
  });

  it("challenging by username ignores case", async () => {
    const alice = await registerUser(app, "alice");
    const bob = await registerUser(app, "bob");
    const created = await app.inject({
      method: "POST",
      url: "/api/challenges",
      cookies: { sessionId: alice },
      payload: { mode: "live", initialMs: 300_000, incrementMs: 0, toUsername: "BOB" },
    });
    expect(created.statusCode).toBe(200);
    const list = await app.inject({ method: "GET", url: "/api/challenges", cookies: { sessionId: bob } });
    expect(list.json().forMe).toHaveLength(1);
  });
});

describe("migration 0003", () => {
  beforeEach(() => openDb(":memory:"));
  afterEach(() => closeDb());

  it("lowercases existing usernames", () => {
    const db = getDb();
    db.prepare(`INSERT INTO users (username, password_hash, created_at) VALUES ('MixedCase', 'x', 0)`).run();
    const sql = readFileSync(new URL("../db/migrations/0003_lowercase_usernames.sql", import.meta.url), "utf8");
    db.exec(sql);
    expect((db.prepare(`SELECT username FROM users`).get() as { username: string }).username).toBe("mixedcase");
  });
});