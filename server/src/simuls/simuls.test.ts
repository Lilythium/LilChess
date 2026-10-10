import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { closeDb, getDb, openDb } from "../db/connection.js";
import { claimTimeoutAndPersist, getExpiredStartedGameIds } from "../db/repositories/games.js";
import { registerUser } from "../testing/helpers.js";

describe("simuls", () => {
  let app: FastifyInstance;
  let host: string, ann: string, ben: string, cyd: string;

  const call = (sid: string, method: "GET" | "POST", url: string, payload?: object) =>
    app.inject({ method, url, cookies: { sessionId: sid }, payload });
  const move = (sid: string, gameId: string, ply: number, uci: string) =>
    call(sid, "POST", `/api/games/${gameId}/move`, { ply, uci });

  beforeEach(async () => {
    openDb(":memory:");
    app = await buildApp();
    host = await registerUser(app, "hana");
    ann = await registerUser(app, "ann");
    ben = await registerUser(app, "ben");
    cyd = await registerUser(app, "cyd");
  });
  afterEach(async () => {
    await app.close();
    closeDb();
  });

  async function openSimul(overrides: Record<string, unknown> = {}) {
    const res = await call(host, "POST", "/api/simuls", {
      name: "Friday simul", mode: "live", initialMs: 300_000, incrementMs: 0,
      hostExtraMinutes: 10, maxPlayers: 10, ...overrides,
    });
    expect(res.statusCode, res.body).toBe(200);
    return res.json().simulId as string;
  }

  /** Invites everyone, has `accepting` accept, starts it, returns the boards. */
  async function runSimul(id: string, accepting: [string, string][]) {
    const names = accepting.map(([name]) => name);
    expect((await call(host, "POST", `/api/simuls/${id}/invite`, { usernames: names })).statusCode).toBe(200);
    for (const [, sid] of accepting) {
      expect((await call(sid, "POST", `/api/simuls/${id}/respond`, { accept: true })).statusCode).toBe(200);
    }
    const started = await call(host, "POST", `/api/simuls/${id}/start`);
    expect(started.statusCode, started.body).toBe(200);
    return (await call(host, "GET", `/api/simuls/${id}`)).json().boards as { gameId: string; username: string; hostColor: string }[];
  }

  it("invites, collects answers, and starts one game per accepted player", async () => {
    const id = await openSimul();
    await call(host, "POST", `/api/simuls/${id}/invite`, { usernames: ["ann", "ben", "cyd"] });
    await call(ann, "POST", `/api/simuls/${id}/respond`, { accept: true });
    await call(ben, "POST", `/api/simuls/${id}/respond`, { accept: false });

    const started = await call(host, "POST", `/api/simuls/${id}/start`);
    expect(started.json().boards).toBe(1);

    const detail = (await call(host, "GET", `/api/simuls/${id}`)).json();
    expect(detail.simul.status).toBe("running");
    expect(detail.players.map((p: any) => [p.username, p.status])).toEqual([
      ["ann", "accepted"], ["ben", "declined"], ["cyd", "invited"],
    ]);
    expect(detail.boards).toHaveLength(1);
    expect(detail.boards[0]).toMatchObject({ username: "ann", hostColor: "white", seat: 1 });

    // Too late to answer once it has started.
    expect((await call(cyd, "POST", `/api/simuls/${id}/respond`, { accept: true })).statusCode).toBe(409);
  });

  it("gives the host extra time and a long first-move window on live boards, and keeps games casual", async () => {
    const id = await openSimul();
    await runSimul(id, [["ann", ann], ["ben", ben]]);
    const rows = getDb().prepare(`
      SELECT g.white_id, g.white_ms, g.black_ms, g.deadline_at, g.created_at, g.rated
      FROM simul_players sp JOIN games g ON g.id = sp.game_id WHERE sp.simul_id = ?
    `).all(id) as { white_ms: number; black_ms: number; deadline_at: number; created_at: number; rated: number }[];
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.rated).toBe(0);
      expect(r.white_ms).toBe(300_000 + 600_000);
      expect(r.black_ms).toBe(300_000);
      expect(r.deadline_at - r.created_at).toBeGreaterThanOrEqual(3 * 60_000 - 1_000); // not the usual 30 s
    }
  });

  it("keeps every board's clock independent", async () => {
    const id = await openSimul();
    const [a, b] = await runSimul(id, [["ann", ann], ["ben", ben]]);

    expect((await move(host, a!.gameId, 0, "e2e4")).statusCode).toBe(200);
    expect((await move(ann, a!.gameId, 1, "e7e5")).statusCode).toBe(200); // board A now has running clocks

    // Board A flags (host to move); board B is untouched.
    expect(claimTimeoutAndPersist(a!.gameId, Date.now() + 3_600_000).ok).toBe(true);
    const state = (gameId: string) =>
      getDb().prepare(`SELECT status, result FROM games WHERE id = ?`).get(gameId) as { status: string; result: string | null };
    expect(state(a!.gameId)).toEqual({ status: "finished", result: "0-1" });
    expect(state(b!.gameId).status).toBe("started");
    expect(claimTimeoutAndPersist(b!.gameId, Date.now()).ok).toBe(false); // deadline is minutes away
  });

  it("settles boards that expired while the server was down, then completes the simul", async () => {
    const id = await openSimul();
    const boards = await runSimul(id, [["ann", ann], ["ben", ben]]);
    getDb().prepare(`UPDATE games SET deadline_at = 1`).run(); // as if the server slept past every deadline

    for (const gameId of getExpiredStartedGameIds(Date.now())) claimTimeoutAndPersist(gameId, Date.now());

    const detail = (await call(host, "GET", `/api/simuls/${id}`)).json();
    expect(detail.simul.status).toBe("completed");
    // Nobody moved: both boards are aborted, so nothing counts as played.
    expect(detail.score).toMatchObject({ aborted: 2, played: 0, ongoing: 0 });
    expect(boards).toHaveLength(2);
  });

  it("completes when the last board ends and scores the host", async () => {
    const id = await openSimul();
    const [a, b] = await runSimul(id, [["ann", ann], ["ben", ben]]);
    expect((await call(ann, "POST", `/api/games/${a!.gameId}/resign`)).statusCode).toBe(200); // host wins A
    let detail = (await call(host, "GET", `/api/simuls/${id}`)).json();
    expect(detail.simul.status).toBe("running");

    await call(host, "POST", `/api/games/${b!.gameId}/resign`); // host loses B
    detail = (await call(host, "GET", `/api/simuls/${id}`)).json();
    expect(detail.simul.status).toBe("completed");
    expect(detail.score).toMatchObject({ wins: 1, losses: 1, points: 1, played: 2 });
  });

  it("rejects what it should", async () => {
    const id = await openSimul();
    expect((await call(host, "POST", "/api/simuls", { name: "Second", mode: "correspondence", daysPerMove: 2, maxPlayers: 4 })).statusCode).toBe(409);
    expect((await call(ann, "POST", `/api/simuls/${id}/start`)).statusCode).toBe(403); // not the host
    expect((await call(host, "POST", `/api/simuls/${id}/start`)).statusCode).toBe(409); // nobody accepted

    const invite = await call(host, "POST", `/api/simuls/${id}/invite`, { usernames: ["hana", "nobody", "ann", "ann"] });
    expect(invite.json().invited).toEqual(["ann"]);
    expect(invite.json().skipped.map((s: any) => s.username).sort()).toEqual(["hana", "nobody"]);

    expect((await call(ben, "POST", `/api/simuls/${id}/respond`, { accept: true })).statusCode).toBe(404); // never invited
    expect((await call(ben, "GET", `/api/simuls/${id}`)).statusCode).toBe(404); // open simuls are private
  });

  it("validates the time settings", async () => {
    const bad = (payload: Record<string, unknown>) =>
      call(host, "POST", "/api/simuls", { name: "Valid name", maxPlayers: 4, ...payload });
    expect((await bad({ mode: "live", initialMs: 300_000, hostColor: "black" })).statusCode).toBe(400);
    expect((await bad({ mode: "live" })).statusCode).toBe(400);
    expect((await bad({ mode: "correspondence", daysPerMove: 2, hostExtraMinutes: 5 })).statusCode).toBe(400);
    expect((await bad({ mode: "correspondence", daysPerMove: 2, hostColor: "alternate" })).statusCode).toBe(200);
  });

  it("limits a simul to its board count", async () => {
    const id = await openSimul({ maxPlayers: 2 });
    await call(host, "POST", `/api/simuls/${id}/invite`, { usernames: ["ann", "ben", "cyd"] });
    expect((await call(ann, "POST", `/api/simuls/${id}/respond`, { accept: true })).statusCode).toBe(200);
    expect((await call(ben, "POST", `/api/simuls/${id}/respond`, { accept: true })).statusCode).toBe(200);
    expect((await call(cyd, "POST", `/api/simuls/${id}/respond`, { accept: true })).statusCode).toBe(409);
  });

  it("disables takebacks in simul games", async () => {
    const id = await openSimul();
    const [a] = await runSimul(id, [["ann", ann]]);
    await move(host, a!.gameId, 0, "e2e4");
    await move(ann, a!.gameId, 1, "e7e5");
    const res = await call(host, "POST", `/api/games/${a!.gameId}/takeback/offer`);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("takebacks_disabled");
  });

  it("alternates the host's colour in correspondence simuls", async () => {
    const id = await openSimul({ mode: "correspondence", daysPerMove: 2, initialMs: undefined, incrementMs: undefined, hostExtraMinutes: 0, hostColor: "alternate" });
    const boards = await runSimul(id, [["ann", ann], ["ben", ben]]);
    expect(boards.map((b) => b.hostColor)).toEqual(["white", "black"]);
  });

  it("keeps simul boards out of the watch list but lists the simul", async () => {
    const id = await openSimul();
    await runSimul(id, [["ann", ann], ["ben", ben]]);
    expect((await call(cyd, "GET", "/api/games/live")).json().games).toHaveLength(0);
    const lists = (await call(cyd, "GET", "/api/simuls")).json();
    expect(lists.running.map((s: any) => s.id)).toEqual([id]);
    expect((await call(cyd, "GET", `/api/simuls/${id}`)).statusCode).toBe(200); // spectators may open a running simul
    // The host's game rows carry the simul id so the UI can group them.
    const mine = (await call(host, "GET", "/api/games/my-games")).json();
    expect([...mine.myTurn, ...mine.theirTurn].every((g: any) => g.simul_id === id && g.simul_host_id !== null)).toBe(true);
  });
});