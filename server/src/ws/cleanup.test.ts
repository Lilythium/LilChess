import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import type WebSocket from "ws";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import { closeDb, openDb } from "../db/connection.js";
import { registerUser, startGame } from "../testing/helpers.js";
import { connectWs, opened, rejectedWith } from "../testing/wsHelpers.js";
import { socketCount } from "./hub.js";
import { MAX_SOCKETS_PER_USER } from "./server.js";

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

const open = (gameId: string, sid: string) => {
  const ws = connectWs(port, gameId, { sid });
  sockets.push(ws);
  return ws;
};

async function game() {
  const alice = await registerUser(app, "alice");
  const bob = await registerUser(app, "bob");
  return { alice, gameId: await startGame(app, alice, bob) };
}

describe("socket bookkeeping", () => {
  it("forgets a socket as soon as it closes", async () => {
    const { alice, gameId } = await game();
    const ws = open(gameId, alice);
    await opened(ws);
    await vi.waitFor(() => expect(socketCount(gameId)).toBe(1));

    ws.terminate();
    await vi.waitFor(() => expect(socketCount(gameId)).toBe(0));
  });

  it("a reconnect replaces the dropped socket instead of adding to it", async () => {
    const { alice, gameId } = await game();
    const first = open(gameId, alice);
    await opened(first);
    first.terminate();

    const second = open(gameId, alice);
    await opened(second);
    await vi.waitFor(() => expect(socketCount(gameId)).toBe(1));
  });

  it("caps open sockets per user", async () => {
    const { alice, gameId } = await game();
    for (let i = 0; i < MAX_SOCKETS_PER_USER; i++) await opened(open(gameId, alice));
    expect(await rejectedWith(open(gameId, alice))).toBe(429);
  });
});