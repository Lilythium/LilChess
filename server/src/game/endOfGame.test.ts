import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { closeDb, getDb, openDb } from "../db/connection.js";
import { registerUser, startGame } from "../testing/helpers.js";

describe("ending a game with offers pending", () => {
  let app: FastifyInstance;
  let alice: string;
  let bob: string;
  let gameId: string;

  const post = (sid: string, path: string, payload?: object) =>
    app.inject({ method: "POST", url: `/api/games/${gameId}/${path}`, cookies: { sessionId: sid }, payload });
  const row = () =>
    getDb().prepare(`SELECT status, draw_offered_by, takeback_offered_by FROM games WHERE id = ?`).get(gameId);

  beforeEach(async () => {
    openDb(":memory:");
    app = await buildApp();
    alice = await registerUser(app, "alice");
    bob = await registerUser(app, "bob");
    gameId = await startGame(app, alice, bob);
    await post(alice, "move", { ply: 0, uci: "e2e4" });
  });
  afterEach(async () => {
    await app.close();
    closeDb();
  });

  it("resign clears a pending draw offer and takeback request", async () => {
    await post(alice, "draw/offer");
    await post(alice, "takeback/offer");
    expect((await post(alice, "resign")).statusCode).toBe(200);
    expect(row()).toEqual({ status: "finished", draw_offered_by: null, takeback_offered_by: null });
  });

  it("accepting a draw clears a pending takeback request", async () => {
    await post(alice, "takeback/offer");
    await post(alice, "draw/offer");
    expect((await post(bob, "draw/accept")).statusCode).toBe(200);
    expect(row()).toEqual({ status: "finished", draw_offered_by: null, takeback_offered_by: null });
  });

  it("abort clears a pending draw offer", async () => {
    await post(alice, "draw/offer");
    expect((await post(bob, "abort")).statusCode).toBe(200);
    expect(row()).toEqual({ status: "aborted", draw_offered_by: null, takeback_offered_by: null });
  });
});