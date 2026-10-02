import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { closeDb, openDb } from "../db/connection.js";
import { registerUser, startGame } from "../testing/helpers.js";

describe("GET /api/games/:id/pgn", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    openDb(":memory:");
    app = await buildApp();
  });
  afterEach(async () => {
    await app.close();
    closeDb();
  });

  it("downloads the game as PGN", async () => {
    const alice = await registerUser(app, "alice");
    const bob = await registerUser(app, "bob");
    const gameId = await startGame(app, alice, bob);
    await app.inject({
      method: "POST",
      url: `/api/games/${gameId}/move`,
      cookies: { sessionId: alice },
      payload: { ply: 0, uci: "e2e4" },
    });

    const res = await app.inject({ method: "GET", url: `/api/games/${gameId}/pgn`, cookies: { sessionId: bob } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/x-chess-pgn");
    expect(res.headers["content-disposition"]).toContain(`lilchess-${gameId}.pgn`);
    expect(res.body).toContain('[White "alice"]');
    expect(res.body).toContain('[Black "bob"]');
    expect(res.body).toContain("1. e4 *");
  });

  it("404s for an unknown game and 401s without a session", async () => {
    const alice = await registerUser(app, "alice");
    const missing = await app.inject({ method: "GET", url: "/api/games/deadbeef/pgn", cookies: { sessionId: alice } });
    expect(missing.statusCode).toBe(404);

    const anon = await app.inject({ method: "GET", url: "/api/games/deadbeef/pgn" });
    expect(anon.statusCode).toBe(401);
  });
});