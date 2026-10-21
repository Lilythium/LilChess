import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { closeDb, getDb, openDb } from "../db/connection.js";

// Mobile Phase 9: a complete game played with bearer tokens only, the way the mobile client plays it.
// No cookies are used anywhere in this file.

describe("a full game over native bearer auth", () => {
  let app: FastifyInstance;
  let alice: string;
  let bob: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const post = (token: string, url: string, payload?: object) =>
    app.inject({ method: "POST", url, headers: auth(token), payload });
  const state = async (token: string, gameId: string) =>
    (await app.inject({ method: "GET", url: `/api/games/${gameId}`, headers: auth(token) })).json();

  async function nativeRegister(username: string): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/api/native/register",
      payload: { username, password: "hunter22!" },
    });
    expect(res.statusCode).toBe(200);
    return res.json().sessionToken as string;
  }

  async function newGame(clock: Record<string, unknown> = { mode: "live", initialMs: 300_000, incrementMs: 0 }) {
    const created = await post(alice, "/api/challenges", { ...clock, colorPref: "white" });
    expect(created.statusCode).toBe(200);
    const accepted = await post(bob, `/api/challenges/${created.json().challengeId}/accept`);
    expect(accepted.statusCode).toBe(200);
    return accepted.json().gameId as string;
  }

  beforeEach(async () => {
    openDb(":memory:");
    app = await buildApp();
    alice = await nativeRegister("alice");
    bob = await nativeRegister("bob");
  });
  afterEach(async () => {
    await app.close();
    closeDb();
  });

  it("plays moves and returns authoritative state to a client that reconnects", async () => {
    const gameId = await newGame();
    expect((await post(alice, `/api/games/${gameId}/move`, { ply: 0, uci: "e2e4" })).statusCode).toBe(200);
    expect((await post(bob, `/api/games/${gameId}/move`, { ply: 1, uci: "e7e5" })).statusCode).toBe(200);

    // A client that lost its socket resyncs from REST alone.
    const resynced = await state(bob, gameId);
    expect(resynced.sans).toEqual(["e4", "e5"]);
    expect(resynced.game.status).toBe("started");
    expect(typeof resynced.serverNow).toBe("number");
  });

  it("does not apply a move twice when the client repeats it after a lost response", async () => {
    const gameId = await newGame();
    const payload = { ply: 0, uci: "e2e4" };
    expect((await post(alice, `/api/games/${gameId}/move`, payload)).statusCode).toBe(200);

    const retry = await post(alice, `/api/games/${gameId}/move`, payload);
    expect(retry.statusCode).toBe(409);
    expect(retry.json().error).toBe("ply_mismatch");

    const count = getDb().prepare(`SELECT COUNT(*) AS n FROM moves WHERE game_id = ?`).get(gameId) as { n: number };
    expect(count.n).toBe(1);
    expect((await state(alice, gameId)).sans).toEqual(["e4"]);
  });

  it("applies exactly one of two simultaneous identical moves", async () => {
    const gameId = await newGame();
    const payload = { ply: 0, uci: "d2d4" };
    const results = await Promise.all([
      post(alice, `/api/games/${gameId}/move`, payload),
      post(alice, `/api/games/${gameId}/move`, payload),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect((await state(alice, gameId)).sans).toEqual(["d4"]);
  });

  it("rejects a move from the wrong side and from a spectator", async () => {
    const gameId = await newGame();
    const carol = await nativeRegister("carol");
    for (const token of [bob, carol]) {
      const res = await post(token, `/api/games/${gameId}/move`, { ply: 0, uci: "e2e4" });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("not_your_turn");
    }
  });

  it("completes by resignation and serves the finished game and its PGN", async () => {
    const gameId = await newGame();
    await post(alice, `/api/games/${gameId}/move`, { ply: 0, uci: "e2e4" });
    expect((await post(bob, `/api/games/${gameId}/resign`)).statusCode).toBe(200);

    expect((await state(alice, gameId)).game.status).toBe("finished");
    const pgn = await app.inject({ method: "GET", url: `/api/games/${gameId}/pgn`, headers: auth(alice) });
    expect(pgn.statusCode).toBe(200);
    expect(pgn.body).toContain("1. e4");

    // Nothing more can be played on a finished game.
    const late = await post(alice, `/api/games/${gameId}/move`, { ply: 1, uci: "e7e5" });
    expect(late.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("completes by agreed draw, and a declined offer leaves the game running", async () => {
    const gameId = await newGame();
    await post(alice, `/api/games/${gameId}/move`, { ply: 0, uci: "e2e4" });

    await post(alice, `/api/games/${gameId}/draw/offer`);
    expect((await post(bob, `/api/games/${gameId}/draw/decline`)).statusCode).toBe(200);
    expect((await state(bob, gameId)).game.status).toBe("started");

    await post(alice, `/api/games/${gameId}/draw/offer`);
    expect((await post(bob, `/api/games/${gameId}/draw/accept`)).statusCode).toBe(200);
    expect((await state(bob, gameId)).game.status).toBe("finished");
  });

  it("takes back a move when the opponent accepts", async () => {
    const gameId = await newGame();
    await post(alice, `/api/games/${gameId}/move`, { ply: 0, uci: "e2e4" });
    await post(bob, `/api/games/${gameId}/move`, { ply: 1, uci: "e7e5" });

    expect((await post(bob, `/api/games/${gameId}/takeback/offer`)).statusCode).toBe(200);
    expect((await post(alice, `/api/games/${gameId}/takeback/accept`)).statusCode).toBe(200);
    expect((await state(alice, gameId)).sans).toEqual(["e4"]);
  });

  it("plays a correspondence move over REST with no socket at all", async () => {
    const gameId = await newGame({ mode: "correspondence", daysPerMove: 3 });
    expect((await post(alice, `/api/games/${gameId}/move`, { ply: 0, uci: "g1f3" })).statusCode).toBe(200);
    expect((await state(bob, gameId)).sans).toEqual(["Nf3"]);
  });
});
