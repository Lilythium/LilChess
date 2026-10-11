import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { START_FEN } from "@lilchess/shared";
import { buildApp } from "../app.js";
import { closeDb, getDb, openDb } from "../db/connection.js";
import { registerUser, startGame } from "../testing/helpers.js";
import { findLegacyImports, purgeLegacyImports } from "./legacy.js";

describe("legacy import cleanup", () => {
  let app: FastifyInstance;
  let alice: string;
  let bob: string;

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

  // What the old importer wrote: importer in one seat, a made-up guest in the other, position never advanced.
  function legacyImport(): string {
    const db = getDb();
    const aliceId = db.prepare(`SELECT id FROM users WHERE username = 'alice'`).pluck().get() as number;
    const guestId = Number(
      db.prepare(`INSERT INTO users (username, password_hash, created_at, is_guest) VALUES ('magnus', '!', 1, 1)`).run().lastInsertRowid,
    );
    db.prepare(`
      INSERT INTO games (id, white_id, black_id, variant, rated, mode, initial_ms, increment_ms, status, result, termination,
        initial_fen, fen, last_move, ply, white_ms, black_ms, turn_started_at, deadline_at, created_at, ended_at)
      VALUES ('deadbeef01', ?, ?, 'standard', 0, 'live', 300000, 0, 'finished', '1-0', 'checkmate', ?, ?, 'h5f7', 2, 0, 0, 1, 1, 1, 1)
    `).run(aliceId, guestId, START_FEN, START_FEN);
    db.prepare(`INSERT INTO moves (game_id, ply, uci, san) VALUES ('deadbeef01', 1, 'e2e4', 'e4'), ('deadbeef01', 2, 'e7e5', 'e5')`).run();
    return "deadbeef01";
  }

  it("finds an old import and purges it with its moves", () => {
    const id = legacyImport();
    expect(findLegacyImports(getDb())).toEqual([{ id, white: "alice", black: "magnus", ply: 2, status: "finished", result: "1-0" }]);
    expect(purgeLegacyImports(getDb())).toBe(1);
    expect(findLegacyImports(getDb())).toEqual([]);
    expect(getDb().prepare(`SELECT COUNT(*) FROM moves`).pluck().get()).toBe(0);
  });

  it("never matches a real game, even one that returns to the starting position", async () => {
    const gameId = await startGame(app, alice, bob);
    // Nf3 Nf6 Ng1 Ng8: same pieces as the start, but the move counters have moved on.
    const move = (sid: string, ply: number, uci: string) =>
      app.inject({ method: "POST", url: `/api/games/${gameId}/move`, cookies: { sessionId: sid }, payload: { ply, uci } });
    await move(alice, 0, "g1f3");
    await move(bob, 1, "g8f6");
    await move(alice, 2, "f3g1");
    await move(bob, 3, "f6g8");
    expect(getDb().prepare(`SELECT ply FROM games WHERE id = ?`).pluck().get(gameId)).toBe(4);
    expect(findLegacyImports(getDb())).toEqual([]);
    expect(purgeLegacyImports(getDb())).toBe(0);
  });
});