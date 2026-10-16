import type { FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { closeDb, getDb, openDb } from "../db/connection.js";
import { migrate } from "../db/migrate.js";
import { registerUser } from "../testing/helpers.js";

describe("variant games over the API", () => {
  let app: FastifyInstance;
  let alice: string; // white
  let bob: string; // black

  const post = (sid: string, url: string, payload?: object) =>
    app.inject({ method: "POST", url, cookies: { sessionId: sid }, payload });

  async function start(variant: string): Promise<string> {
    const made = await post(alice, "/api/challenges", {
      mode: "live", initialMs: 300_000, incrementMs: 0, colorPref: "white", variant,
    });
    expect(made.statusCode, made.body).toBe(200);
    const acc = await post(bob, `/api/challenges/${made.json().challengeId}/accept`);
    expect(acc.statusCode, acc.body).toBe(200);
    return acc.json().gameId as string;
  }

  /** Plays moves alternately, alice first, returning the last response. */
  async function playMoves(gameId: string, moves: string[]) {
    let last;
    for (const [i, uci] of moves.entries()) {
      last = await post(i % 2 === 0 ? alice : bob, `/api/games/${gameId}/move`, { ply: i, uci });
      expect(last.statusCode, `${uci}: ${last.body}`).toBe(200);
    }
    return last!;
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

  it("plays a Crazyhouse drop and stores it with a SAN", async () => {
    const id = await start("crazyhouse");
    await playMoves(id, ["e2e4", "d7d5", "e4d5", "g8f6", "P@e4"]);
    const game = (await app.inject({ method: "GET", url: `/api/games/${id}`, cookies: { sessionId: alice } })).json();
    expect(game.game?.variant ?? game.variant).toBe("crazyhouse");
    const stored = getDb().prepare(`SELECT uci, san FROM moves WHERE game_id = ? AND ply = 5`).get(id);
    expect(stored).toEqual({ uci: "P@e4", san: "@e4" });
    const row = getDb().prepare(`SELECT fen FROM games WHERE id = ?`).get(id) as { fen: string };
    expect(row.fen).toContain("["); // pockets survive in the stored position
  });

  it("rejects a drop of a piece the player does not hold", async () => {
    const id = await start("crazyhouse");
    await playMoves(id, ["e2e4"]);
    const res = await post(bob, `/api/games/${id}/move`, { ply: 1, uci: "Q@e5" });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("rejects drops in a game that is not Crazyhouse", async () => {
    const id = await start("standard");
    const res = await post(alice, `/api/games/${id}/move`, { ply: 0, uci: "P@e4" });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("finishes a Three-check game on the third check and records the termination", async () => {
    const id = await start("threecheck");
    await playMoves(id, ["e2e4", "e7e5", "f1c4", "b8c6", "c4f7", "e8f7", "d1h5", "f7e7", "h5e5"]);
    const row = getDb().prepare(`SELECT status, result, termination FROM games WHERE id = ?`).get(id);
    expect(row).toEqual({ status: "finished", result: "1-0", termination: "three_check" });
  });

  it("enforces compulsory captures in Antichess", async () => {
    const id = await start("antichess");
    await playMoves(id, ["e2e4", "d7d5"]);
    const quiet = await post(alice, `/api/games/${id}/move`, { ply: 2, uci: "a2a3" });
    expect(quiet.statusCode).toBeGreaterThanOrEqual(400);
    const capture = await post(alice, `/api/games/${id}/move`, { ply: 2, uci: "e4d5" });
    expect(capture.statusCode).toBe(200);
  });

  it("exports Crazyhouse PGN with its Variant header", async () => {
    const id = await start("crazyhouse");
    await playMoves(id, ["e2e4"]);
    const pgn = await app.inject({ method: "GET", url: `/api/games/${id}/pgn`, cookies: { sessionId: alice } });
    expect(pgn.statusCode).toBe(200);
    expect(pgn.body).toContain('[Variant "Crazyhouse"]');
  });
});

describe("migration 0021 (more variants)", () => {
  it("keeps existing rows and then accepts the new variants, terminations and drops", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    migrate(db, 20);
    db.exec(`
      INSERT INTO users (id, username, password_hash, created_at) VALUES (1,'alice','x',0),(2,'bob','x',0);
      INSERT INTO games (id, white_id, black_id, mode, initial_ms, increment_ms, status, result, termination,
                         initial_fen, ply, white_ms, black_ms, turn_started_at, deadline_at, created_at, ended_at)
        VALUES ('g1',1,2,'live',60000,0,'finished','1-0','resignation',
                'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',1,60000,60000,0,0,5,6);
      INSERT INTO moves (game_id, ply, uci, san) VALUES ('g1',1,'e2e4','e4');
      INSERT INTO challenges (id, from_user, mode, initial_ms, increment_ms, created_at, expires_at)
        VALUES ('c1',1,'live',60000,0,0,99);
      INSERT INTO tournaments (id, created_by, name, mode, initial_ms, increment_ms, max_players, created_at)
        VALUES ('t1',1,'T','live',60000,0,8,0);
      INSERT INTO simuls (id, host_id, name, mode, initial_ms, increment_ms, max_players, created_at)
        VALUES ('s1',1,'S','live',60000,0,8,0);
    `);

    migrate(db);

    const count = (t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
    for (const t of ["games", "moves", "challenges", "tournaments", "simuls"]) expect(count(t), t).toBe(1);
    expect(db.pragma("foreign_key_check")).toEqual([]);

    db.exec(`
      UPDATE games SET variant = 'crazyhouse', termination = 'three_check' WHERE id = 'g1';
      INSERT INTO moves (game_id, ply, uci, san) VALUES ('g1',2,'N@f3','@f3'),('g1',3,'a7a8k','a8=K');
      UPDATE challenges SET variant = 'antichess';
      UPDATE tournaments SET variant = 'threecheck', format = 'simul2';
      UPDATE simuls SET variant = 'crazyhouse';
    `);
    expect(() => db.exec(`UPDATE games SET termination = 'bogus' WHERE id = 'g1'`)).toThrow();
    expect(() => db.exec(`UPDATE simuls SET variant = 'bogus'`)).toThrow();
    expect(() => db.exec(`INSERT INTO moves (game_id, ply, uci, san) VALUES ('g1',4,'Z@a1','x')`)).toThrow();

    // The simul-completion trigger survived the rebuild of both tables it touches.
    const trigger = db.prepare(`SELECT name FROM sqlite_master WHERE type='trigger' AND name='simuls_complete_after_game'`).get();
    expect(trigger).toBeTruthy();
  });
});
