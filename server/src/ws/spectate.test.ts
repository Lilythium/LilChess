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
    // Disable compression to prevent the "RSV1 must be clear" frame error in tests
    perMessageDeflate: false,
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

// Helper to buffer all messages instantly and avoid race conditions with initial 'sync' broadcasts.
function listen(ws: WebSocket) {
  const queue: any[] = [];
  const waiters: { resolve: (msg: any) => void; reject: (err: Error) => void }[] = [];
  let closed = false;
  let closeError = "";

  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    if (waiters.length > 0) {
      waiters.shift()!.resolve(msg);
    } else {
      queue.push(msg);
    }
  });
  
  ws.on("close", (code, reason) => {
    closed = true;
    closeError = `WebSocket closed (code ${code}): ${reason.toString()}`;
    while (waiters.length > 0) {
      waiters.shift()!.reject(new Error(closeError));
    }
  });
  
  ws.on("error", (err) => {
    closed = true;
    closeError = `WebSocket error: ${err.message}`;
    while (waiters.length > 0) {
      waiters.shift()!.reject(err);
    }
  });

  return async function nextMessage() {
    if (queue.length > 0) return queue.shift();
    if (closed) throw new Error(closeError);
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no message within 3s")), 3000);
      waiters.push({
        resolve: (msg) => { clearTimeout(timer); resolve(msg); },
        reject: (err) => { clearTimeout(timer); reject(err); }
      });
    });
  };
}

describe("spectating", () => {
  it("lets a non-player watch moves as they happen", async () => {
    const alice = await registerUser(app, "alice");
    const bob = await registerUser(app, "bob");
    const carol = await registerUser(app, "carol");
    const gameId = await startGame(app, alice, bob);

    const spectator = connect(gameId, carol);
    const nextMessage = listen(spectator); // Start listening immediately!
    await opened(spectator);

    const res = await app.inject({
      method: "POST",
      url: `/api/games/${gameId}/move`,
      cookies: { sessionId: alice },
      payload: { ply: 0, uci: "e2e4" },
    });
    expect(res.statusCode).toBe(200);

    // Skip any initial sync/state messages until we see the move broadcast
    let msg = await nextMessage();
    while (msg && msg.type !== "move") {
      msg = await nextMessage();
    }
    
    expect(msg).toMatchObject({ type: "move", ply: 1, uci: "e2e4", san: "e4" });
  });

  it("does not let a spectator move", async () => {
    const alice = await registerUser(app, "alice");
    const bob = await registerUser(app, "bob");
    const carol = await registerUser(app, "carol");
    const gameId = await startGame(app, alice, bob);

    const spectator = connect(gameId, carol);
    const nextMessage = listen(spectator); // Start listening immediately!
    await opened(spectator);

    spectator.send(JSON.stringify({ type: "move", ply: 0, uci: "e2e4" }));

    // Skip any initial sync/state messages until we see the error response
    let msg = await nextMessage();
    while (msg && msg.type !== "error") {
      msg = await nextMessage();
    }

    expect(msg).toEqual({ type: "error", error: "spectators_cannot_move" });

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