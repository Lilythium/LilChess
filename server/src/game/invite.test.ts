import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { config } from "../config.js";
import { closeDb, openDb } from "../db/connection.js";
import { registerUser } from "../testing/helpers.js";

describe("invite links and guests", () => {
  let app: FastifyInstance;
  let alice: string;

  const challenge = (sid: string, payload: Record<string, unknown>) =>
    app.inject({
      method: "POST",
      url: "/api/challenges",
      cookies: { sessionId: sid },
      payload: { mode: "live", initialMs: 300_000, incrementMs: 0, ...payload },
    });
  const makeLink = async () => (await challenge(alice, { link: true, colorPref: "white" })).json().challengeId as string;
  const makeGuest = async (challengeId: string) => {
    const res = await app.inject({ method: "POST", url: "/api/guest", payload: { challengeId } });
    return { res, sid: res.cookies.find((c) => c.name === "sessionId")?.value };
  };

  beforeEach(async () => {
    openDb(":memory:");
    app = await buildApp();
    alice = await registerUser(app, "alice");
  });
  afterEach(async () => {
    config.allowGuests = true;
    await app.close();
    closeDb();
  });

  it("keeps link challenges out of the open list but shows them to their creator", async () => {
    const bob = await registerUser(app, "bob");
    const id = await makeLink();
    expect(id).toMatch(/^[0-9a-f]{16}$/);

    const forBob = await app.inject({ method: "GET", url: "/api/challenges", cookies: { sessionId: bob } });
    expect(forBob.json().open).toEqual([]);

    const mine = await app.inject({ method: "GET", url: "/api/challenges", cookies: { sessionId: alice } });
    expect(mine.json().mine.map((c: { id: string }) => c.id)).toEqual([id]);
    expect(mine.json().mine[0].is_link).toBe(1);
  });

  it("creates guests only for open or link challenges, and only when enabled", async () => {
    await registerUser(app, "bob");
    const targeted = (await challenge(alice, { toUsername: "bob" })).json().challengeId as string;
    expect((await makeGuest(targeted)).res.statusCode).toBe(403);
    expect((await makeGuest("deadbeefdeadbeef")).res.statusCode).toBe(404);

    const open = (await challenge(alice, {})).json().challengeId as string;
    expect((await makeGuest(open)).res.statusCode).toBe(200);

    const id = await makeLink();
    config.allowGuests = false;
    expect((await makeGuest(id)).res.statusCode).toBe(403);
  });

  it("creates a guest with a year-long session cookie", async () => {
    const { res, sid } = await makeGuest(await makeLink());
    expect(res.statusCode).toBe(200);
    expect(res.json().user.username).toMatch(/^guest_[0-9a-f]{6}$/);
    expect(res.cookies.find((c) => c.name === "sessionId")?.maxAge).toBe(365 * 24 * 60 * 60);

    const me = await app.inject({ method: "GET", url: "/api/me", cookies: { sessionId: sid! } });
    expect(me.json().user.is_guest).toBe(1);
  });

  it("lets a guest accept the link and play", async () => {
    const id = await makeLink();
    const { sid } = await makeGuest(id);
    const accepted = await app.inject({
      method: "POST", url: `/api/challenges/${id}/accept`, cookies: { sessionId: sid! },
    });
    expect(accepted.statusCode).toBe(200);
    const gameId = accepted.json().gameId as string;

    const state = await app.inject({ method: "GET", url: `/api/games/${gameId}`, cookies: { sessionId: sid! } });
    expect(state.statusCode).toBe(200);
    expect(state.json().players.whiteName).toBe("alice"); // creator asked for white

    // the link is single-use
    const again = await app.inject({
      method: "POST", url: `/api/challenges/${id}/accept`, cookies: { sessionId: alice },
    });
    expect(again.statusCode).toBe(404);
  });

  it("stops guests creating challenges and stops users challenging guests", async () => {
    const { res, sid } = await makeGuest(await makeLink());
    const create = await challenge(sid!, {});
    expect(create.statusCode).toBe(403);

    const target = await challenge(alice, { toUsername: res.json().user.username });
    expect(target.statusCode).toBe(400);
  });

  it("never lets a guest log in with a password, and reserves the guest_ prefix", async () => {
    const { res } = await makeGuest(await makeLink());
    const login = await app.inject({
      method: "POST", url: "/api/login",
      payload: { username: res.json().user.username, password: "!" },
    });
    expect(login.statusCode).toBe(401);

    const reg = await app.inject({
      method: "POST", url: "/api/register",
      payload: { username: "guest_abc123", password: "hunter22!" },
    });
    expect(reg.statusCode).toBe(400);
  });
});