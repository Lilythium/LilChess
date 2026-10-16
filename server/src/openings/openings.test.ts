import type { FastifyInstance } from "fastify";
import { fixedStartFen } from "@lilchess/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { closeDb, getDb, openDb } from "../db/connection.js";
import { registerUser } from "../testing/helpers.js";
import { backfillOpenings, OPENING_MAX_PLY, openingExplorer, recordOpeningGame } from "./stats.js";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("opening explorer", () => {
  let app: FastifyInstance;
  let alice: string;
  let bob: string;

  const post = (sid: string, url: string, payload?: object) => app.inject({ method: "POST", url, cookies: { sessionId: sid }, payload });
  const explorer = async (qs = "") =>
    (await app.inject({ method: "GET", url: `/api/openings${qs}`, cookies: { sessionId: alice } })).json();

  /** Plays `moves` from a fresh game, then ends it: `loser` resigns (or draws by agreement). */
  async function play(moves: string[], end: "white" | "black" | "draw", variant = "standard"): Promise<string> {
    const made = await post(alice, "/api/challenges", { mode: "live", initialMs: 300_000, incrementMs: 0, colorPref: "white", variant });
    const id = (await post(bob, `/api/challenges/${made.json().challengeId}/accept`)).json().gameId as string;
    for (const [i, uci] of moves.entries()) {
      const r = await post(i % 2 === 0 ? alice : bob, `/api/games/${id}/move`, { ply: i, uci });
      expect(r.statusCode, `${uci}: ${r.body}`).toBe(200);
    }
    if (end === "draw") {
      await post(alice, `/api/games/${id}/draw/offer`);
      await post(bob, `/api/games/${id}/draw/accept`);
    } else {
      await post(end === "white" ? bob : alice, `/api/games/${id}/resign`);
    }
    return id;
  }

  beforeEach(async () => {
    openDb(":memory:");
    app = await buildApp();
    alice = await registerUser(app, "alice");
    bob = await registerUser(app, "bob");
  });
  afterEach(async () => {
    await app.close();
    closeDb();
  });

  it("counts finished games by the move played and the result", async () => {
    await play(["e2e4", "e7e5"], "white");
    await play(["e2e4", "c7c5"], "black");
    await play(["d2d4", "d7d5"], "draw");
    await play(["e2e4", "e7e5"], "draw");

    const root = await explorer();
    expect(root).toMatchObject({ total: 4, white: 1, draws: 2, black: 1, fen: START });
    expect(root.moves.map((m: { san: string; total: number }) => [m.san, m.total])).toEqual([["e4", 3], ["d4", 1]]);
    const e4 = root.moves[0];
    expect([e4.white, e4.draws, e4.black]).toEqual([1, 1, 1]);

    const afterE4 = await explorer("?fen=" + encodeURIComponent("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1"));
    expect(afterE4.moves.map((m: { san: string; total: number }) => [m.san, m.total])).toEqual([["e5", 2], ["c5", 1]]);
  });

  it("merges transpositions into one position", async () => {
    // Two move orders reach the same position after four plies, then White plays different fifth moves.
    await play(["e2e4", "e7e5", "g1f3", "b8c6", "f1b5"], "white");
    await play(["g1f3", "b8c6", "e2e4", "e7e5", "f1c4"], "black");
    const fen = "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3";
    const merged = await explorer("?fen=" + encodeURIComponent(fen));
    expect(merged.total).toBe(2);
    expect(merged.moves.map((m: { san: string }) => m.san).sort()).toEqual(["Bb5", "Bc4"]);
  });

  it("ignores aborted and unfinished games", async () => {
    const made = await post(alice, "/api/challenges", { mode: "live", initialMs: 300_000, incrementMs: 0, colorPref: "white" });
    const id = (await post(bob, `/api/challenges/${made.json().challengeId}/accept`)).json().gameId as string;
    await post(alice, `/api/games/${id}/move`, { ply: 0, uci: "e2e4" });
    expect(recordOpeningGame(id)).toBe(false); // still running
    expect((await explorer()).total).toBe(0);
  });

  it("counts a game once however often it is recorded", async () => {
    const id = await play(["e2e4", "e7e5"], "white");
    expect(recordOpeningGame(id)).toBe(false); // already counted when it finished
    expect(backfillOpenings()).toBe(0);
    expect((await explorer()).total).toBe(1);
  });

  it("backfills games that finished before the explorer existed", async () => {
    const id = await play(["e2e4", "e7e5"], "white");
    getDb().exec(`DELETE FROM opening_moves; DELETE FROM opening_games;`);
    expect((await explorer()).total).toBe(0);
    expect(backfillOpenings()).toBe(1);
    expect((await explorer()).total).toBe(1);
    expect(getDb().prepare(`SELECT COUNT(*) FROM opening_games WHERE game_id = ?`).pluck().get(id)).toBe(1);
  });

  it("only explores the opening: later moves are not counted", () => {
    expect(OPENING_MAX_PLY).toBe(24);
  });

  it("keeps variants apart and supports drops", async () => {
    await play(["e2e4", "d7d5", "e4d5", "g8f6", "P@e4"], "white", "crazyhouse");
    expect((await explorer("?variant=standard")).total).toBe(0);
    const root = await explorer("?variant=crazyhouse");
    expect(root.total).toBe(1);
    expect(root.fen).toBe(fixedStartFen("crazyhouse"));
    const later = await explorer("?variant=crazyhouse&fen=" + encodeURIComponent("rnbqkb1r/ppp1pppp/5n2/3P4/8/8/PPPP1PPP/RNBQKBNR[P] w KQkq - 1 3"));
    expect(later.moves.map((m: { san: string }) => m.san)).toEqual(["@e4"]);
  });

  it("rejects a bad position or variant, and needs login", async () => {
    expect((await app.inject({ method: "GET", url: "/api/openings?fen=nonsense", cookies: { sessionId: alice } })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/api/openings?variant=atomic", cookies: { sessionId: alice } })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/api/openings" })).statusCode).toBe(401);
  });

  it("returns an empty tree for a position nobody has reached", () => {
    const r = openingExplorer("standard", START);
    expect(r).toMatchObject({ total: 0, moves: [] });
  });
});
