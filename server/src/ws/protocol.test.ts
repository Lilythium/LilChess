import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import type WebSocket from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { closeDb, openDb } from "../db/connection.js";
import { registerUser, startGame } from "../testing/helpers.js";
import { closedWith, connectWs, listen, opened, rejectedWith } from "../testing/wsHelpers.js";

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

function open(gameId: string, sid?: string, origin?: string): WebSocket {
  const ws = connectWs(port, gameId, { sid, origin });
  sockets.push(ws);
  return ws;
}

async function twoPlayerGame() {
  const alice = await registerUser(app, "alice");
  const bob = await registerUser(app, "bob");
  const gameId = await startGame(app, alice, bob);
  return { alice, bob, gameId };
}

describe("message handling", () => {
  it("answers malformed JSON with bad_json and keeps the socket usable", async () => {
    const { alice, gameId } = await twoPlayerGame();
    const ws = open(gameId, alice);
    const msgs = listen(ws);
    await opened(ws);

    ws.send("{not json");
    expect(await msgs.next()).toEqual({ type: "error", error: "bad_json" });
    expect(ws.readyState).toBe(ws.OPEN);

    ws.send(JSON.stringify({ type: "move", ply: 0, uci: "e2e4" }));
    expect(await msgs.nextOfType("move")).toMatchObject({ ply: 1, uci: "e2e4" });
  });

  it("silently ignores binary frames", async () => {
    const { alice, gameId } = await twoPlayerGame();
    const ws = open(gameId, alice);
    const msgs = listen(ws);
    await opened(ws);

    ws.send(Buffer.from("{}"), { binary: true });
    ws.send("{not json");
    // If the binary frame had produced a reply it would arrive first.
    expect(await msgs.next()).toEqual({ type: "error", error: "bad_json" });
  });

  it("rejects well-formed JSON of the wrong shape", async () => {
    const { alice, gameId } = await twoPlayerGame();
    const ws = open(gameId, alice);
    const msgs = listen(ws);
    await opened(ws);

    ws.send(JSON.stringify({}));
    expect(await msgs.next()).toEqual({ type: "error", error: "bad_message" });
    ws.send(JSON.stringify({ type: "nope" }));
    expect(await msgs.next()).toEqual({ type: "error", error: "bad_message" });
  });

  it.each([
    ["uci is a number", { type: "move", ply: 0, uci: 5 }],
    ["uci is not a square pair", { type: "move", ply: 0, uci: "Z9Z9" }],
    ["ply is negative", { type: "move", ply: -1, uci: "e2e4" }],
    ["ply is fractional", { type: "move", ply: 1.5, uci: "e2e4" }],
    ["ply is a string", { type: "move", ply: "0", uci: "e2e4" }],
  ])("returns bad_message when %s", async (_label, payload) => {
    const { alice, gameId } = await twoPlayerGame();
    const ws = open(gameId, alice);
    const msgs = listen(ws);
    await opened(ws);

    ws.send(JSON.stringify(payload));
    expect(await msgs.next()).toEqual({ type: "error", error: "bad_message" });
  });

  it("reports ply_mismatch and not_your_turn from the shared move path", async () => {
    const { alice, bob, gameId } = await twoPlayerGame();
    const a = open(gameId, alice);
    const aMsgs = listen(a);
    const b = open(gameId, bob);
    const bMsgs = listen(b);
    await Promise.all([opened(a), opened(b)]);

    a.send(JSON.stringify({ type: "move", ply: 7, uci: "e2e4" }));
    expect(await aMsgs.next()).toEqual({ type: "error", error: "ply_mismatch" });

    b.send(JSON.stringify({ type: "move", ply: 0, uci: "e7e5" }));
    expect(await bMsgs.next()).toEqual({ type: "error", error: "not_your_turn" });
  });

  it("closes the socket when a frame exceeds the payload limit", async () => {
    const { alice, gameId } = await twoPlayerGame();
    const ws = open(gameId, alice);
    await opened(ws);
    const closed = closedWith(ws);
    ws.send("x".repeat(2_000));
    expect(await closed).toBe(1009);
  });
});

describe("upgrade origin check", () => {
  it("rejects an upgrade from a foreign origin even with a valid session", async () => {
    const { alice, gameId } = await twoPlayerGame();
    const ws = open(gameId, alice, "http://evil.example");
    expect(await rejectedWith(ws)).toBe(403);
  });

  it("accepts an upgrade whose Origin matches the Host", async () => {
    const { alice, gameId } = await twoPlayerGame();
    const ws = open(gameId, alice, `http://127.0.0.1:${port}`);
    await expect(opened(ws)).resolves.toBeUndefined();
  });
});

describe("reconnect", () => {
  it("a player who missed a move resyncs over REST and keeps playing on the new socket", async () => {
    const { alice, bob, gameId } = await twoPlayerGame();

    const first = open(gameId, bob);
    await opened(first);
    first.terminate(); // bob drops

    const moved = await app.inject({
      method: "POST",
      url: `/api/games/${gameId}/move`,
      cookies: { sessionId: alice },
      payload: { ply: 0, uci: "e2e4" },
    });
    expect(moved.statusCode).toBe(200);

    const second = open(gameId, bob);
    const msgs = listen(second);
    await opened(second);

    // The new socket gets no replay of the missed event; REST is the source of truth.
    const state = await app.inject({ method: "GET", url: `/api/games/${gameId}`, cookies: { sessionId: bob } });
    expect(state.json().game.moves).toEqual(["e2e4"]);
    expect(state.json().sans).toEqual(["e4"]);

    second.send(JSON.stringify({ type: "move", ply: 1, uci: "e7e5" }));
    expect(await msgs.nextOfType("move")).toMatchObject({ ply: 2, uci: "e7e5", san: "e5" });
  });
});