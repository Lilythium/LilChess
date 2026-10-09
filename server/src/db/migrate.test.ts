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

  it("moves existing tournament games into round pairings when upgrading to v11", () => {
    const db = open();
    migrate(db, 10);
    db.exec(`
      INSERT INTO users (id, username, password_hash, created_at) VALUES (1,'alice','x',0),(2,'bob','x',0);
      INSERT INTO tournaments (id, created_by, name, mode, initial_ms, increment_ms, variant, max_players, created_at, status)
        VALUES ('event0001',1,'Old Cup','live',60000,0,'standard',4,0,'running');
      INSERT INTO tournament_participants (tournament_id, user_id, joined_at) VALUES ('event0001',1,0),('event0001',2,0);
      INSERT INTO games (
        id, white_id, black_id, mode, initial_ms, increment_ms, status, initial_fen,
        white_ms, black_ms, turn_started_at, deadline_at, created_at
      ) VALUES (
        'game000001',1,2,'live',60000,0,'started',
        'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        60000,60000,0,30000,0
      );
      INSERT INTO tournament_games (tournament_id, game_id, round_number) VALUES ('event0001','game000001',2);
    `);

    migrate(db);

    expect(db.prepare(`
      SELECT tournament_id, round_number, white_id, black_id, game_id
      FROM tournament_pairings
    `).get()).toEqual({
      tournament_id: "event0001", round_number: 2, white_id: 1, black_id: 2, game_id: "game000001",
    });
    expect(db.prepare(`SELECT rated, current_round FROM tournaments WHERE id = 'event0001'`).get())
      .toEqual({ rated: 0, current_round: 1 });
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });

  it("keeps existing tournaments and pairings when upgrading to v13 (formats)", () => {
    const db = open();
    migrate(db, 12);
    db.exec(`
      INSERT INTO users (id, username, password_hash, created_at) VALUES (1,'alice','x',0),(2,'bob','x',0);
      INSERT INTO tournaments (id, created_by, name, mode, initial_ms, increment_ms, variant, max_players, created_at, status, current_round)
        VALUES ('event0001',1,'Old Cup','live',60000,0,'standard',4,0,'running',1);
      INSERT INTO tournament_participants (tournament_id, user_id, joined_at, paused) VALUES ('event0001',1,0,0),('event0001',2,0,1);
      INSERT INTO tournament_pairings (tournament_id, round_number, board_number, white_id, black_id, forfeit_by)
        VALUES ('event0001',1,1,1,2,2);
    `);

    migrate(db);

    expect(db.prepare(`SELECT format, rounds, duration_ms, streak_bonus, status FROM tournaments WHERE id = 'event0001'`).get())
      .toEqual({ format: "round_robin", rounds: 1, duration_ms: null, streak_bonus: 1, status: "running" });
    expect(db.prepare(`SELECT white_id, black_id, forfeit_by, is_bye, match_number, leg FROM tournament_pairings`).get())
      .toEqual({ white_id: 1, black_id: 2, forfeit_by: 2, is_bye: 0, match_number: null, leg: 1 });
    expect(db.prepare(`SELECT user_id, paused, seed FROM tournament_participants ORDER BY user_id`).all())
      .toEqual([{ user_id: 1, paused: 0, seed: null }, { user_id: 2, paused: 1, seed: null }]);
    expect(db.pragma("foreign_key_check")).toEqual([]);

    // New formats are allowed, arenas need a duration, byes carry no opponent or game.
    const insert = (format: string, extra = "NULL") => db.prepare(`
      INSERT INTO tournaments (id, created_by, name, format, mode, initial_ms, increment_ms, max_players, created_at, duration_ms)
      VALUES (?, 1, 'x', ?, 'live', 60000, 0, 8, 0, ${extra})
    `).run(`t-${format}-${extra}`, format);
    expect(() => insert("swiss")).not.toThrow();
    expect(() => insert("knockout")).not.toThrow();
    expect(() => insert("arena", "1800000")).not.toThrow();
    expect(() => insert("arena")).toThrow();
    expect(() => insert("ladder")).toThrow();
    expect(() => db.prepare(`
      INSERT INTO tournament_pairings (tournament_id, round_number, board_number, white_id, black_id, is_bye)
      VALUES ('event0001', 2, 1, 1, 2, 1)
    `).run()).toThrow();
    expect(() => db.prepare(`
      INSERT INTO tournament_pairings (tournament_id, round_number, board_number, white_id, is_bye)
      VALUES ('event0001', 2, 1, 1, 1)
    `).run()).not.toThrow();
  });
});
