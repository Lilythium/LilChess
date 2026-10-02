import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { closeDb, openDb } from "../db/connection.js";
import { registerUser, startGame } from "../testing/helpers.js";

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

function connect(gameId: string, sid?: string): WebSocket {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/games/${gameId}`, {
    headers: sid ? { Cookie: `sessionId=${sid}` } : {},
  });
  ws.on("error", () => {}); // a rejected upgrade surfaces as an error too
  sockets.push(ws);
  return ws;
}

const opened = (ws: WebSocket) =>
  new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("unexpected-response", (_req, res) => reject(new Error(`status ${res.statusCode}`)));
  });

const rejectedWith = (ws: WebSocket) =>
  new Promise<number>((resolve) => {
    ws.once("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
  });

const nextMessage = (ws: WebSocket) =>
  new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no message within 3s")), 3_000);
    ws.once("message", (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()));
    });
  });

describe("spectating", () => {
  it("lets a non-player watch moves as they happen", async () => {
    const alice = await registerUser(app, "alice");
    const bob = await registerUser(app, "bob");
    const carol = await registerUser(app, "carol");
    const gameId = await startGame(app, alice, bob);

    const spectator = connect(gameId, carol);
    await opened(spectator);
    const incoming = nextMessage(spectator);

    const res = await app.inject({
      method: "POST",
      url: `/api/games/${gameId}/move`,
      cookies: { sessionId: alice },
      payload: { ply: 0, uci: "e2e4" },
    });
    expect(res.statusCode).toBe(200);
    expect(await incoming).toMatchObject({ type: "move", ply: 1, uci: "e2e4", san: "e4" });
  });

  it("does not let a spectator move", async () => {
    const alice = await registerUser(app, "alice");
    const bob = await registerUser(app, "bob");
    const carol = await registerUser(app, "carol");
    const gameId = await startGame(app, alice, bob);

    const spectator = connect(gameId, carol);
    await opened(spectator);
    const reply = nextMessage(spectator);
    spectator.send(JSON.stringify({ type: "move", ply: 0, uci: "e2e4" }));
    expect(await reply).toEqual({ type: "error", error: "spectators_cannot_move" });

    const state = await app.inject({ method: "GET", url: `/api/games/${gameId}`, cookies: { sessionId: carol } });
    expect(state.json().game.ply).toBe(0);
  });

  it("still requires a session and an existing game", async () => {
    const alice = await registerUser(app, "alice");
    const bob = await registerUser(app, "bob");
    const gameId = await startGame(app, alice, bob);

    expect(await rejectedWith(connect(gameId))).toBe(401);
    expect(await rejectedWith(connect("deadbeef", alice))).toBe(404);
  });
});