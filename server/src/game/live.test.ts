import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { closeDb, openDb } from "../db/connection.js";
import { registerUser, startGame } from "../testing/helpers.js";

describe("GET /api/games/live", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    openDb(":memory:");
    app = await buildApp();
  });
  afterEach(async () => {
    await app.close();
    closeDb();
  });

  it("lists games in progress for any logged-in user, and drops them once finished", async () => {
    const alice = await registerUser(app, "alice");
    const bob = await registerUser(app, "bob");
    const carol = await registerUser(app, "carol");
    const gameId = await startGame(app, alice, bob);

    const live = await app.inject({ method: "GET", url: "/api/games/live", cookies: { sessionId: carol } });
    expect(live.statusCode).toBe(200);
    const games = live.json().games;
    expect(games).toHaveLength(1);
    expect(games[0]).toMatchObject({ id: gameId, white_name: "alice", black_name: "bob", mode: "live" });
    expect(games[0].fen).toContain("rnbqkbnr/pppppppp");

    await app.inject({ method: "POST", url: `/api/games/${gameId}/resign`, cookies: { sessionId: bob } });
    const after = await app.inject({ method: "GET", url: "/api/games/live", cookies: { sessionId: carol } });
    expect(after.json().games).toEqual([]);
  });

  it("requires a session", async () => {
    const res = await app.inject({ method: "GET", url: "/api/games/live" });
    expect(res.statusCode).toBe(401);
  });
});