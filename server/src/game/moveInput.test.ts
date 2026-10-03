import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { closeDb, openDb } from "../db/connection.js";
import { registerUser, startGame } from "../testing/helpers.js";

describe("POST /api/games/:id/move input handling", () => {
  let app: FastifyInstance;
  let alice: string;
  let bob: string;
  let carol: string;
  let gameId: string;

  const move = (sid: string, payload: unknown) =>
    app.inject({
      method: "POST",
      url: `/api/games/${gameId}/move`,
      cookies: { sessionId: sid },
      payload: payload as object,
    });

  beforeEach(async () => {
    openDb(":memory:");
    app = await buildApp();
    alice = await registerUser(app, "alice");
    bob = await registerUser(app, "bob");
    carol = await registerUser(app, "carol");
    gameId = await startGame(app, alice, bob);
  });
  afterEach(async () => {
    await app.close();
    closeDb();
  });

  it.each(["e2e9", "Z9Z9", "e2", "e2e4qq", "e2e4k", ""])("400s for uci %j", async (uci) => {
    expect((await move(alice, { ply: 0, uci })).statusCode).toBe(400);
  });

  it.each([5, null, {}, ["e2e4"], true])("400s for non-string uci %j", async (uci) => {
    expect((await move(alice, { ply: 0, uci })).statusCode).toBe(400);
  });

  it("400s for a missing uci or ply", async () => {
    expect((await move(alice, { ply: 0 })).statusCode).toBe(400);
    expect((await move(alice, { uci: "e2e4" })).statusCode).toBe(400);
  });

  it.each([-1, 1.5, "0", null, 10_001])("400s for ply %j", async (ply) => {
    expect((await move(alice, { ply, uci: "e2e4" })).statusCode).toBe(400);
  });

  it("409s with ply_mismatch when the ply is stale or ahead", async () => {
    const res = await move(alice, { ply: 3, uci: "e2e4" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("ply_mismatch");
  });

  it("409s with not_your_turn for the wrong player and for spectators", async () => {
    for (const sid of [bob, carol]) {
      const res = await move(sid, { ply: 0, uci: "e2e4" });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("not_your_turn");
    }
  });

  it("400s with illegal_move for a well-formed but illegal move", async () => {
    const res = await move(alice, { ply: 0, uci: "e2e5" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("illegal_move");
  });

  it("401s without a session and 404s for an unknown game", async () => {
    const anon = await app.inject({
      method: "POST",
      url: `/api/games/${gameId}/move`,
      payload: { ply: 0, uci: "e2e4" },
    });
    expect(anon.statusCode).toBe(401);

    const missing = await app.inject({
      method: "POST",
      url: "/api/games/deadbeef/move",
      cookies: { sessionId: alice },
      payload: { ply: 0, uci: "e2e4" },
    });
    expect(missing.statusCode).toBe(404);
  });

  it("leaves the game untouched after all that rejected input", async () => {
    await move(alice, { ply: 0, uci: "Z9Z9" });
    await move(alice, { ply: -1, uci: "e2e4" });
    await move(bob, { ply: 0, uci: "e7e5" });
    const state = await app.inject({ method: "GET", url: `/api/games/${gameId}`, cookies: { sessionId: alice } });
    expect(state.json().game.ply).toBe(0);
  });
});