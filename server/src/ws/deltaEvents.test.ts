import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import type WebSocket from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { closeDb, openDb } from "../db/connection.js";
import { registerUser, startGame } from "../testing/helpers.js";
import { connectWs, listen, opened } from "../testing/wsHelpers.js";

// Game events are deltas: the move, takeback and game_over events carry what changed, not the game. These tests pin
// that the closing events are self-sufficient (final ply and clocks) and stay a small fraction of the game payload.

let app: FastifyInstance;
let port: number;
const sockets: WebSocket[] = [];

beforeEach(async () => {
  openDb(":memory:");
  app = await buildApp();
  await app.listen({ port: 0, host: "127.0.0.1" });
  port = (app.server.address() as AddressInfo).port;
});

afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  await app.close();
  closeDb();
});

async function openGame() {
  const alice = await registerUser(app, "alice");
  const bob = await registerUser(app, "bob");
  const gameId = await startGame(app, alice, bob);
  const ws = connectWs(port, gameId, { sid: alice });
  sockets.push(ws);
  const msgs = listen(ws);
  await opened(ws);
  const post = (sid: string, path: string, payload?: object) =>
    app.inject({ method: "POST", url: `/api/games/${gameId}/${path}`, cookies: { sessionId: sid }, payload });
  return { alice, bob, gameId, msgs, post };
}

describe("game_over event", () => {
  it("carries the final ply and clocks after a resignation", async () => {
    const { alice, bob, msgs, post } = await openGame();
    await post(alice, "move", { ply: 0, uci: "e2e4" });
    await post(bob, "move", { ply: 1, uci: "e7e5" });
    await post(alice, "resign");

    const over = await msgs.nextOfType("game_over");
    expect(over).toMatchObject({ status: "finished", result: "0-1", termination: "resignation", ply: 2 });
    expect(typeof over.whiteMs).toBe("number");
    expect(typeof over.blackMs).toBe("number");
  });

  it("carries the final ply after an abort", async () => {
    const { alice, msgs, post } = await openGame();
    await post(alice, "abort");

    expect(await msgs.nextOfType("game_over")).toMatchObject({ status: "aborted", termination: "abort", ply: 0 });
  });

  it("is a small fraction of the full game payload", async () => {
    const { alice, bob, gameId, msgs, post } = await openGame();
    const line = ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6", "d2d3", "f8c5"];
    for (let ply = 0; ply < line.length; ply++) {
      await post(ply % 2 === 0 ? alice : bob, "move", { ply, uci: line[ply] });
    }
    await post(alice, "resign");

    const over = await msgs.nextOfType("game_over");
    const full = await app.inject({ method: "GET", url: `/api/games/${gameId}`, cookies: { sessionId: alice } });
    const summary = await app.inject({ method: "GET", url: `/api/games/${gameId}/summary`, cookies: { sessionId: alice } });

    expect(JSON.stringify(over).length).toBeLessThan(full.body.length / 2);
    expect(summary.body.length).toBeLessThan(full.body.length);
  });
});

describe("takeback event", () => {
  it("carries the new ply, side to move and clocks", async () => {
    const { alice, bob, msgs, post } = await openGame();
    await post(alice, "move", { ply: 0, uci: "e2e4" });
    await post(alice, "takeback/offer");
    await post(bob, "takeback/accept");

    expect(await msgs.nextOfType("takeback")).toMatchObject({ ply: 0, turn: "white" });
  });
});

describe("GET /api/games/:id/summary", () => {
  it("returns players, the viewer's head-to-head and no moves", async () => {
    const { alice, bob, gameId, post } = await openGame();
    await post(alice, "move", { ply: 0, uci: "e2e4" });

    const res = await app.inject({ method: "GET", url: `/api/games/${gameId}/summary`, cookies: { sessionId: bob } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ ok: true, players: { whiteName: "alice", blackName: "bob" } });
    expect(body.h2h).toEqual({ wins: 0, draws: 0, losses: 0 });
    expect(typeof body.serverNow).toBe("number");
    expect(body).not.toHaveProperty("game");
    expect(body).not.toHaveProperty("sans");
  });

  it("gives a spectator no head-to-head", async () => {
    const { gameId } = await openGame();
    const carol = await registerUser(app, "carol");

    const res = await app.inject({ method: "GET", url: `/api/games/${gameId}/summary`, cookies: { sessionId: carol } });
    expect(res.json().h2h).toBeNull();
  });

  it("requires a login and 404s for an unknown game", async () => {
    const { alice, gameId } = await openGame();

    expect((await app.inject({ method: "GET", url: `/api/games/${gameId}/summary` })).statusCode).toBe(401);
    const missing = await app.inject({ method: "GET", url: "/api/games/ffffffff/summary", cookies: { sessionId: alice } });
    expect(missing.statusCode).toBe(404);
  });
});
