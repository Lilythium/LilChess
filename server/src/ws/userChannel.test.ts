import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UserEventSchema } from "@lilchess/shared";
import { buildApp } from "../app.js";
import { closeDb } from "../db/connection.js";
import { openDb } from "../db/connection.js";
import { registerUser } from "../testing/helpers.js";
import { userSocketCount } from "./hub.js";

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

function connect(sid?: string): WebSocket {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/me`, {
    headers: sid ? { Cookie: `sessionId=${sid}` } : {},
    perMessageDeflate: false,
  });
  ws.on("error", () => {});
  sockets.push(ws);
  return ws;
}

const opened = (ws: WebSocket) => new Promise<void>((resolve, reject) => {
  ws.once("open", () => resolve());
  ws.once("unexpected-response", (_req, res) => reject(new Error(`status ${res.statusCode}`)));
});
const nextMessage = (ws: WebSocket) => new Promise<unknown>((resolve) => ws.once("message", (data) => resolve(JSON.parse(data.toString()))));

async function startTournament(owner: string, others: string[], extra: Record<string, unknown> = {}) {
  const created = await app.inject({
    method: "POST", url: "/api/tournaments", cookies: { sessionId: owner },
    payload: { name: "Cup", mode: "live", initialMs: 300_000, incrementMs: 0, maxPlayers: 8, ...extra },
  });
  const id = created.json().tournamentId as string;
  for (const sid of others) await app.inject({ method: "POST", url: `/api/tournaments/${id}/join`, cookies: { sessionId: sid } });
  await app.inject({ method: "POST", url: `/api/tournaments/${id}/start`, cookies: { sessionId: owner } });
  return id;
}

describe("/ws/me", () => {
  it("requires a session", async () => {
    await expect(opened(connect())).rejects.toThrow("status 401");
  });

  it("pushes pairing_ready to both players when a live tournament starts, and cleans up on close", async () => {
    const alice = await registerUser(app, "alice");
    const bob = await registerUser(app, "bob");
    const wsA = connect(alice);
    const wsB = connect(bob);
    await Promise.all([opened(wsA), opened(wsB)]);
    const a = nextMessage(wsA);
    const b = nextMessage(wsB);

    const id = await startTournament(alice, [bob]);
    const [eventA, eventB] = [UserEventSchema.parse(await a), UserEventSchema.parse(await b)];
    expect(eventA).toMatchObject({ type: "pairing_ready", tournamentId: id, round: 1 });
    expect(eventB).toEqual(eventA);

    wsA.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const aliceId = 1;
    expect(userSocketCount(aliceId)).toBe(0);
  });

  it("does not push for correspondence tournaments (their games all exist from the start)", async () => {
    const alice = await registerUser(app, "alice");
    const bob = await registerUser(app, "bob");
    const ws = connect(alice);
    await opened(ws);
    const received: unknown[] = [];
    ws.on("message", (data) => received.push(JSON.parse(data.toString())));
    await startTournament(alice, [bob], { mode: "correspondence", daysPerMove: 3, initialMs: undefined, incrementMs: undefined });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(received).toEqual([]);
  });
});