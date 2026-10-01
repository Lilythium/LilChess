import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { closeDb, openDb } from "./db/connection.js";

describe("HTTP hardening", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    openDb(":memory:");
    app = await buildApp();
  });
  afterEach(async () => {
    await app.close();
    closeDb();
  });

  it("returns 400 for invalid registration input", async () => {
    const res = await app.inject({ method: "POST", url: "/api/register", payload: { username: "a!", password: "x" } });
    expect(res.statusCode).toBe(400);
  });

  it("rejects oversized bodies with 413", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/login",
      payload: { username: "a", password: "b", pad: "x".repeat(20_000) },
    });
    expect(res.statusCode).toBe(413);
  });

  it("blocks cross-origin state-changing requests", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/logout",
      headers: { origin: "http://evil.example", host: "chess.test" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("allows same-origin requests", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/logout",
      headers: { origin: "http://chess.test", host: "chess.test" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("registers a user whose session cookie works on /api/me", async () => {
    const reg = await app.inject({
      method: "POST",
      url: "/api/register",
      payload: { username: "alice", password: "hunter22!" },
    });
    expect(reg.statusCode).toBe(200);
    const sid = reg.cookies.find((c) => c.name === "sessionId")?.value;
    expect(sid).toBeTruthy();

    const me = await app.inject({ method: "GET", url: "/api/me", cookies: { sessionId: sid! } });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.username).toBe("alice");
  });

  it("rate-limits login attempts (10/min per IP)", async () => {
    const attempt = () =>
      app.inject({ method: "POST", url: "/api/login", payload: { username: "nobody", password: "wrongwrong" } });
    for (let i = 0; i < 10; i++) expect((await attempt()).statusCode).toBe(401);
    expect((await attempt()).statusCode).toBe(429);
  });

  it("returns 400 for a malformed move body", async () => {
    const reg = await app.inject({
      method: "POST",
      url: "/api/register",
      payload: { username: "bob", password: "hunter22!" },
    });
    const sid = reg.cookies.find((c) => c.name === "sessionId")!.value;
    const res = await app.inject({
      method: "POST",
      url: "/api/games/aaaaaaaa/move",
      cookies: { sessionId: sid },
      payload: { ply: 0, uci: 5 },
    });
    expect(res.statusCode).toBe(400);
  });
});