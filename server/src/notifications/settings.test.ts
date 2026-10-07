import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { closeDb, getDb, openDb } from "../db/connection.js";
import { registerUser } from "../testing/helpers.js";

describe("notification settings", () => {
  let app: FastifyInstance;
  let alice: string;

  const get = () => app.inject({ method: "GET", url: "/api/me/notifications", cookies: { sessionId: alice } });
  const put = (payload: object) =>
    app.inject({ method: "PUT", url: "/api/me/notifications", cookies: { sessionId: alice }, payload });

  beforeEach(async () => {
    openDb(":memory:");
    app = await buildApp();
    alice = await registerUser(app, "alice");
  });
  afterEach(async () => {
    await app.close();
    closeDb();
  });

  it("starts with no email and everything on; the server reports it can't send yet", async () => {
    const body = (await get()).json();
    expect(body.email).toBeNull();
    expect(body.emailAvailable).toBe(false);
    expect(Object.values(body.prefs)).toEqual([true, true, true, true, true]);
  });

  it("stores a lowercased email, shows it on /api/me, and removes it again", async () => {
    expect((await put({ email: " Alice@Example.com " })).json().email).toBe("alice@example.com");
    const me = await app.inject({ method: "GET", url: "/api/me", cookies: { sessionId: alice } });
    expect(me.json().user.email).toBe("alice@example.com");
    expect((await put({ email: "" })).json().email).toBeNull();
    expect(getDb().prepare(`SELECT unsubscribe_token FROM users WHERE username = 'alice'`).get())
      .toEqual({ unsubscribe_token: null });
  });

  it("rejects a malformed email and unknown notification kinds", async () => {
    expect((await put({ email: "nope" })).statusCode).toBe(400);
    expect((await put({ prefs: { spam: true } })).statusCode).toBe(400);
  });

  it("changes only the prefs it is given", async () => {
    const body = (await put({ prefs: { your_turn: false } })).json();
    expect(body.prefs).toMatchObject({ your_turn: false, challenge_received: true, game_completed: true });
  });

  it("requires a session and refuses guests", async () => {
    expect((await app.inject({ method: "GET", url: "/api/me/notifications" })).statusCode).toBe(401);

    const link = await app.inject({
      method: "POST", url: "/api/challenges", cookies: { sessionId: alice },
      payload: { mode: "live", initialMs: 300_000, incrementMs: 0, link: true },
    });
    const guest = await app.inject({ method: "POST", url: "/api/guest", payload: { challengeId: link.json().challengeId } });
    const sid = guest.cookies.find((c) => c.name === "sessionId")!.value;
    const res = await app.inject({
      method: "PUT", url: "/api/me/notifications", cookies: { sessionId: sid }, payload: { email: "g@example.com" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("unsubscribe link switches every kind off, and rejects unknown or malformed tokens", async () => {
    await put({ email: "alice@example.com" });
    const { unsubscribe_token } = getDb().prepare(`SELECT unsubscribe_token FROM users`).get() as { unsubscribe_token: string };
    const post = (token: string) => app.inject({ method: "POST", url: "/api/unsubscribe", payload: { token } });

    expect((await post(unsubscribe_token)).statusCode).toBe(200);
    expect(Object.values((await get()).json().prefs)).toEqual([false, false, false, false, false]);
    expect((await post("0".repeat(32))).statusCode).toBe(404);
    expect((await post("nope")).statusCode).toBe(400);
  });
});