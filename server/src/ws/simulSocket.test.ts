import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import type WebSocket from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { closeDb, openDb } from "../db/connection.js";
import { registerUser } from "../testing/helpers.js";
import { connectSimulWs, connectWs, listen, opened, rejectedWith } from "../testing/wsHelpers.js";
import { socketCount } from "./hub.js";

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

const track = <T extends WebSocket>(ws: T): T => (sockets.push(ws), ws);
const call = (sid: string, method: "GET" | "POST", url: string, payload?: object) =>
  app.inject({ method, url, cookies: { sessionId: sid }, payload });

async function runningSimul() {
  const host = await registerUser(app, "hana");
  const ann = await registerUser(app, "ann");
  const ben = await registerUser(app, "ben");
  const watcher = await registerUser(app, "wanda");
  const created = await call(host, "POST", "/api/simuls", {
    name: "Socket simul", mode: "live", initialMs: 300_000, incrementMs: 0, maxPlayers: 4,
  });
  const simulId = created.json().simulId as string;
  await call(host, "POST", `/api/simuls/${simulId}/invite`, { usernames: ["ann", "ben"] });
  await call(ann, "POST", `/api/simuls/${simulId}/respond`, { accept: true });
  await call(ben, "POST", `/api/simuls/${simulId}/respond`, { accept: true });
  await call(host, "POST", `/api/simuls/${simulId}/start`);
  const boards = (await call(host, "GET", `/api/simuls/${simulId}`)).json().boards as { gameId: string }[];
  return { host, ann, ben, watcher, simulId, boards };
}

describe("simul channel", () => {
  it("pushes a board update to a spectator after the host moves", async () => {
    const { host, watcher, simulId, boards } = await runningSimul();
    const ws = track(connectSimulWs(port, simulId, { sid: watcher }));
    const msgs = listen(ws);
    await opened(ws);

    await call(host, "POST", `/api/games/${boards[0]!.gameId}/move`, { ply: 0, uci: "e2e4" });
    expect(await msgs.next()).toMatchObject({
      type: "simul_board", simulId, gameId: boards[0]!.gameId, ply: 1, turn: "black", status: "started", drawOfferedBy: null,
    });
  });

  it("announces the end of the simul after the last board", async () => {
    const { host, ann, ben, simulId, boards } = await runningSimul();
    const ws = track(connectSimulWs(port, simulId, { sid: host }));
    const msgs = listen(ws);
    await opened(ws);

    await call(ann, "POST", `/api/games/${boards[0]!.gameId}/resign`);
    await call(ben, "POST", `/api/games/${boards[1]!.gameId}/resign`);

    const seen: string[] = [];
    for (let i = 0; i < 3; i++) seen.push((await msgs.next()).type);
    expect(seen).toEqual(["simul_board", "simul_board", "simul_state"]);
  });

  it("refuses anonymous, wrong-origin and unknown-simul upgrades; hides open simuls from strangers", async () => {
    const { simulId, watcher } = await runningSimul();
    expect(await rejectedWith(track(connectSimulWs(port, simulId)))).toBe(401);
    expect(await rejectedWith(track(connectSimulWs(port, simulId, { sid: watcher, origin: "http://evil.example" })))).toBe(403);
    expect(await rejectedWith(track(connectSimulWs(port, "0".repeat(16), { sid: watcher })))).toBe(404);

    const host2 = await registerUser(app, "hugo");
    const open = (await call(host2, "POST", "/api/simuls", {
      name: "Not started", mode: "correspondence", daysPerMove: 2, maxPlayers: 3,
    })).json().simulId as string;
    expect(await rejectedWith(track(connectSimulWs(port, open, { sid: watcher })))).toBe(404);
  });

  it("closing one board's socket leaves the other boards alone", async () => {
    const { host, simulId, boards } = await runningSimul();
    const [a, b] = boards as [{ gameId: string }, { gameId: string }];
    const wsA = track(connectWs(port, a.gameId, { sid: host }));
    const wsB = track(connectWs(port, b.gameId, { sid: host }));
    const overview = track(connectSimulWs(port, simulId, { sid: host }));
    const onB = listen(wsB);
    await Promise.all([opened(wsA), opened(wsB), opened(overview)]);

    wsA.terminate();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(socketCount(a.gameId)).toBe(0);
    expect(socketCount(b.gameId)).toBe(1);

    await call(host, "POST", `/api/games/${b.gameId}/move`, { ply: 0, uci: "d2d4" });
    expect(await onB.next()).toMatchObject({ type: "move", gameId: b.gameId, ply: 1 });
  });
});