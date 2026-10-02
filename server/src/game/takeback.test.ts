import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { closeDb, openDb } from "../db/connection.js";
import { registerUser, startGame } from "../testing/helpers.js";

describe("takeback endpoints", () => {
  let app: FastifyInstance;
  let alice: string;
  let bob: string;
  let gameId: string;

  const post = (sid: string, path: string, payload?: unknown) =>
    app.inject({ method: "POST", url: `/api/games/${gameId}/${path}`, cookies: { sessionId: sid }, payload: payload as object });
  const getState = async () =>
    (await app.inject({ method: "GET", url: `/api/games/${gameId}`, cookies: { sessionId: alice } })).json().game;

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

  it("offer then accept removes the last move", async () => {
    expect((await post(alice, "takeback/offer")).statusCode).toBe(200);
    expect((await getState()).takebackOfferedBy).toBe("white");

    expect((await post(bob, "takeback/accept")).statusCode).toBe(200);
    const game = await getState();
    expect(game.moves).toEqual([]);
    expect(game.ply).toBe(0);
    expect(game.takebackOfferedBy).toBeUndefined();
  });

  it("the opponent can decline", async () => {
    await post(alice, "takeback/offer");
    expect((await post(bob, "takeback/decline")).statusCode).toBe(200);
    const game = await getState();
    expect(game.takebackOfferedBy).toBeUndefined();
    expect(game.moves).toEqual(["e2e4"]);
  });

  it("the requester can't accept their own offer, and black can't offer yet", async () => {
    const early = await post(bob, "takeback/offer");
    expect(early.statusCode).toBe(400);
    expect(early.json().error).toBe("nothing_to_take_back");

    await post(alice, "takeback/offer");
    const self = await post(alice, "takeback/accept");
    expect(self.statusCode).toBe(400);
    expect(self.json().error).toBe("no_takeback_to_accept");
  });
});