import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { backfillPositions } from "./backfill.js";
import { latestVersion, migrate } from "./migrate.js";

const open = () => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  return db;
};

describe("migrate", () => {
  it("builds a fresh database at the latest version and leaves foreign keys on", () => {
    const db = open();
    migrate(db);
    expect(db.prepare(`SELECT version FROM schema_version`).get()).toEqual({ version: latestVersion() });
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    migrate(db); // idempotent
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });

  it("upgrades a v4 database in place, repairing old rows and keeping the data", () => {
    const db = open();
    migrate(db, 4);
    db.exec(`
      INSERT INTO users (id, username, password_hash, created_at) VALUES (1,'alice','x',0),(2,'bob','x',0);
      INSERT INTO games (id, white_id, black_id, mode, initial_ms, increment_ms, status, result, termination,
                         initial_fen, ply, white_ms, black_ms, turn_started_at, deadline_at, draw_offered_by, created_at)
        VALUES ('g1',1,2,'live',60000,0,'finished','1-0','resignation',
                'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',1,60000,60000,0,0,'black',5);
      INSERT INTO moves (game_id, ply, uci, san) VALUES ('g1',1,'e2e4','e4');
    `);

    migrate(db);

    const g = db.prepare(`SELECT draw_offered_by, ended_at, fen FROM games WHERE id = 'g1'`).get() as
      { draw_offered_by: string | null; ended_at: number | null; fen: string | null };
    expect(g.draw_offered_by).toBeNull(); // repaired: no offers on an ended game
    expect(g.ended_at).toBe(5);           // repaired: falls back to created_at
    expect(g.fen).toBeNull();             // filled by the backfill, not SQL

    expect(backfillPositions(db)).toBe(1);
    const after = db.prepare(`SELECT fen, last_move FROM games`).get() as { fen: string; last_move: string };
    expect(after.fen).toMatch(/^rnbqkbnr\/pppppppp\/8\/8\/4P3\/8\/PPPP1PPP\/RNBQKBNR b KQkq/);
    expect(after.last_move).toBe("e2e4");
    expect(backfillPositions(db)).toBe(0);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM moves`).get()).toEqual({ n: 1 });
  });
});