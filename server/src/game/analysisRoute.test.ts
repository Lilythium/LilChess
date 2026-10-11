import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { closeDb, openDb } from "../db/connection.js";
import { registerUser, startGame } from "../testing/helpers.js";

describe("GET /api/games/:id/analysis", () => {
  let app: FastifyInstance;
  let alice: string;
  let bob: string;
  let carol: string;
  let gameId: string;

  const move = (sid: string, ply: number, uci: string) =>
    app.inject({ method: "POST", url: `/api/games/${gameId}/move`, cookies: { sessionId: sid }, payload: { ply, uci } });
  const analysis = (sid: string, id = gameId) =>
    app.inject({ method: "GET", url: `/api/games/${id}/analysis`, cookies: { sessionId: sid } });

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

  async function playFoolsMate() {
    await move(alice, 0, "f2f3");
    await move(bob, 1, "e7e5");
    await move(alice, 2, "g2g4");
    await move(bob, 3, "d8h4");
  }

  it("serves a finished game's moves and players to any signed-in user", async () => {
    await playFoolsMate();
    const res = await analysis(carol); // a spectator, not a player
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toContain("max-age");
    const body = res.json();
    expect(body).toMatchObject({
      ok: true, variant: "standard", status: "finished", result: "0-1", termination: "checkmate",
      white: "alice", black: "bob", moves: ["f2f3", "e7e5", "g2g4", "d8h4"],
    });
    expect(body.initialFen).toContain("rnbqkbnr/pppppppp");
  });

  it("refuses a game in progress (the page must not be an engine feed during play)", async () => {
    await move(alice, 0, "e2e4");
    const res = await analysis(carol);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("game_not_finished");
  });

  it("requires a session", async () => {
    const anon = await app.inject({ method: "GET", url: `/api/games/${gameId}/analysis` });
    expect(anon.statusCode).toBe(401);
  });

  it("404s for a well-formed id that doesn't exist and 400s for a malformed one", async () => {
    expect((await analysis(alice, "deadbeef00000000")).statusCode).toBe(404);
    expect((await analysis(alice, "nope1234")).statusCode).toBe(400);
  });
  it("GET /api/games/:id still returns the same shape after the query consolidation", async () => {
    await playFoolsMate();
    const body = (await app.inject({ method: "GET", url: `/api/games/${gameId}`, cookies: { sessionId: alice } })).json();
    expect(body.game.moves).toEqual(["f2f3", "e7e5", "g2g4", "d8h4"]);
    expect(body.sans).toEqual(["f3", "e5", "g4", "Qh4#"]);
  });
});
