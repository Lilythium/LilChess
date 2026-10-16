import { makeSan } from "chessops/san";
import { parseUci } from "chessops/util";
import { fenOf, positionFromFen, positionKey, type Variant } from "@lilchess/shared";
import { getDb } from "../db/connection.js";

/** Only the opening is explored: positions after this many plies are not counted. */
export const OPENING_MAX_PLY = 24;
const EXPLORER_MOVE_LIMIT = 30;

interface FinishedGameRow {
  id: string;
  variant: Variant;
  initial_fen: string;
  result: "1-0" | "0-1" | "1/2-1/2";
}

/**
 * Adds a finished game to the opening statistics. Idempotent: a game that is already counted, or that
 * isn't a finished game with moves, changes nothing. Returns whether it was counted now.
 */
export function recordOpeningGame(gameId: string): boolean {
  const db = getDb();
  const game = db
    .prepare(`SELECT id, variant, initial_fen, result FROM games WHERE id = ? AND status = 'finished' AND result IS NOT NULL`)
    .get(gameId) as FinishedGameRow | undefined;
  if (!game) return false;

  return db.transaction(() => {
    if (db.prepare(`INSERT OR IGNORE INTO opening_games (game_id) VALUES (?)`).run(gameId).changes === 0) return false;
    const moves = (db.prepare(`SELECT uci FROM moves WHERE game_id = ? AND ply <= ? ORDER BY ply`).all(gameId, OPENING_MAX_PLY) as { uci: string }[]);
    const column = game.result === "1-0" ? "white" : game.result === "0-1" ? "black" : "draws";
    const bump = db.prepare(`
      INSERT INTO opening_moves (variant, position_key, uci, ${column}) VALUES (?, ?, ?, 1)
      ON CONFLICT (variant, position_key, uci) DO UPDATE SET ${column} = ${column} + 1
    `);
    const pos = positionFromFen(game.initial_fen, game.variant);
    for (const { uci } of moves) {
      bump.run(game.variant, positionKey(pos), uci);
      const move = parseUci(uci);
      if (!move || !pos.isLegal(move)) break; // corrupt history: keep what we have
      pos.play(move);
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
