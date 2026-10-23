import { makeSan } from "chessops/san";
import { parseUci } from "chessops/util";
import { fenOf, positionFromFen, positionKey, type Variant } from "@lilchess/shared";
import { getDb } from "../db/connection.js";

/** Only the opening is explored: positions after this many plies are not counted. */
export const OPENING_MAX_PLY = 24;
const EXPLORER_MOVE_LIMIT = 30;
const OPENING_GAME_LIMIT = 100;

interface FinishedGameRow {
  id: string;
  variant: Variant;
  initial_fen: string;
  ply: number;
  result: "1-0" | "0-1" | "1/2-1/2";
}

/**
 * Adds a finished game to the opening statistics. Idempotent: a game that is already counted, or that
 * isn't a finished game with moves, changes nothing. Returns whether it was counted now.
 */
export function recordOpeningGame(gameId: string): boolean {
  const db = getDb();
  const game = db
    .prepare(`SELECT id, variant, initial_fen, ply, result FROM games WHERE id = ? AND status = 'finished' AND result IS NOT NULL`)
    .get(gameId) as FinishedGameRow | undefined;
  if (!game) return false;

  return db.transaction(() => {
    if (db.prepare(`INSERT OR IGNORE INTO opening_games (game_id) VALUES (?)`).run(gameId).changes === 0) return false;
    const moves = db.prepare(`
      SELECT m.uci FROM moves m
      WHERE m.game_id = ? AND m.ply <= ?
        AND m.id = (SELECT MAX(previous.id) FROM moves previous
                    WHERE previous.game_id = m.game_id AND previous.ply = m.ply)
      ORDER BY m.ply
    `).all(gameId, Math.min(game.ply, OPENING_MAX_PLY)) as { uci: string }[];
    const column = game.result === "1-0" ? "white" : game.result === "0-1" ? "black" : "draws";
    const bump = db.prepare(`
      INSERT INTO opening_moves (variant, position_key, uci, ${column}) VALUES (?, ?, ?, 1)
      ON CONFLICT (variant, position_key, uci) DO UPDATE SET ${column} = ${column} + 1
    `);
    const pos = positionFromFen(game.initial_fen, game.variant);
    const indexPosition = db.prepare(`INSERT OR IGNORE INTO opening_positions (variant, position_key, game_id) VALUES (?, ?, ?)`);
    indexPosition.run(game.variant, positionKey(pos), gameId);
    for (const { uci } of moves) {
      bump.run(game.variant, positionKey(pos), uci);
      const move = parseUci(uci);
      if (!move || !pos.isLegal(move)) break; // corrupt history: keep what we have
      pos.play(move);
      indexPosition.run(game.variant, positionKey(pos), gameId);
    }
    return true;
  })();
}

/** Counts every finished game that isn't counted yet (first run after upgrading, or games ended by an admin). */
export function backfillOpenings(): number {
  const db = getDb();
  const ids = db
    .prepare(`SELECT id FROM games WHERE status = 'finished' AND id NOT IN (SELECT game_id FROM opening_games)`)
    .all() as { id: string }[];
  let counted = 0;
  for (const { id } of ids) if (recordOpeningGame(id)) counted++;
  return counted;
}

/** Adds position indexes for games counted before position-based game lists were introduced. */
export function backfillOpeningPositions(): number {
  const db = getDb();
  const games = db.prepare(`
    SELECT g.id, g.variant, g.initial_fen
    FROM opening_games og JOIN games g ON g.id = og.game_id
    WHERE NOT EXISTS (SELECT 1 FROM opening_positions op WHERE op.game_id = g.id)
  `).all() as { id: string; variant: Variant; initial_fen: string }[];
  for (const game of games) {
    db.transaction(() => indexOpeningPositions(game.id, game.variant, game.initial_fen))();
  }
  return games.length;
}

export interface ExplorerMove {
  uci: string;
  san: string;
  white: number;
  draws: number;
  black: number;
  total: number;
}

export interface ExplorerResult {
  variant: Variant;
  fen: string;
  white: number;
  draws: number;
  black: number;
  total: number;
  moves: ExplorerMove[];
}

export interface OpeningGame {
  id: string;
  white_name: string;
  white_rating: number | null;
  black_name: string;
  black_rating: number | null;
  result: "1-0" | "0-1" | "1/2-1/2";
  ended_at: number | null;
  fen: string;
  last_move: string | null;
}

function indexOpeningPositions(gameId: string, variant: Variant, initialFen: string): void {
  const db = getDb();
  const moves = db.prepare(`
    SELECT m.uci FROM moves m
    JOIN games g ON g.id = m.game_id
    WHERE m.game_id = ? AND m.ply <= ? AND m.ply <= g.ply
      AND m.id = (SELECT MAX(previous.id) FROM moves previous
                  WHERE previous.game_id = m.game_id AND previous.ply = m.ply)
    ORDER BY m.ply
  `).all(gameId, OPENING_MAX_PLY) as { uci: string }[];
  const insert = db.prepare(`INSERT OR IGNORE INTO opening_positions (variant, position_key, game_id) VALUES (?, ?, ?)`);
  const pos = positionFromFen(initialFen, variant);
  insert.run(variant, positionKey(pos), gameId);
  for (const { uci } of moves) {
    const move = parseUci(uci);
    if (!move || !pos.isLegal(move)) break;
    pos.play(move);
    insert.run(variant, positionKey(pos), gameId);
  }
}

/** What has been played from `fen` on this server. Throws "invalid_initial_fen" for a bad position. */
export function openingExplorer(variant: Variant, fen: string): ExplorerResult {
  const pos = positionFromFen(fen, variant);
  const rows = getDb()
    .prepare(`
      SELECT uci, white, draws, black FROM opening_moves
      WHERE variant = ? AND position_key = ?
      ORDER BY white + draws + black DESC, uci LIMIT ?
    `)
    .all(variant, positionKey(pos), EXPLORER_MOVE_LIMIT) as { uci: string; white: number; draws: number; black: number }[];

  const moves: ExplorerMove[] = [];
  for (const row of rows) {
    const move = parseUci(row.uci);
    if (!move || !pos.isLegal(move)) continue;
    moves.push({ ...row, san: makeSan(pos, move), total: row.white + row.draws + row.black });
  }
  const sum = (key: "white" | "draws" | "black") => moves.reduce((n, m) => n + m[key], 0);
  return {
    variant, fen: fenOf(pos),
    white: sum("white"), draws: sum("draws"), black: sum("black"),
    total: moves.reduce((n, m) => n + m.total, 0),
    moves,
  };
}

/** Recent finished games that reached a position, with a total for the capped sidebar list. */
export function openingGamesAtPosition(variant: Variant, fen: string): { games: OpeningGame[]; gamesTotal: number } {
  const posKey = positionKey(positionFromFen(fen, variant));
  const db = getDb();
  const where = `
    FROM opening_positions op
    JOIN games g ON g.id = op.game_id
    JOIN users wu ON wu.id = g.white_id
    JOIN users bu ON bu.id = g.black_id
    WHERE op.variant = ? AND op.position_key = ? AND g.status = 'finished'`;
  const gamesTotal = (db.prepare(`SELECT COUNT(*) AS total ${where}`).get(variant, posKey) as { total: number }).total;
  const games = db.prepare(`
    SELECT g.id, wu.username AS white_name,
           (SELECT CAST(ROUND(r.rating) AS INTEGER) FROM ratings r WHERE r.user_id = g.white_id AND r.variant = g.variant) AS white_rating,
           bu.username AS black_name,
           (SELECT CAST(ROUND(r.rating) AS INTEGER) FROM ratings r WHERE r.user_id = g.black_id AND r.variant = g.variant) AS black_rating,
           g.result, g.ended_at, COALESCE(g.fen, g.initial_fen) AS fen, g.last_move
    ${where}
    ORDER BY g.ended_at DESC, g.id DESC LIMIT ?
  `).all(variant, posKey, OPENING_GAME_LIMIT) as OpeningGame[];
  return { games, gamesTotal };
}
