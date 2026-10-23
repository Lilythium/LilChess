import type Database from "better-sqlite3";
import { fenAfterMoves, type Variant } from "@lilchess/shared";

// Fills games.fen / games.last_move for rows that predate migration 0006. A no-op once everything is filled.
export function backfillPositions(db: Database.Database): number {
  const rows = db.prepare(`SELECT id, variant, initial_fen, ply FROM games WHERE fen IS NULL`).all() as
    { id: string; variant: Variant; initial_fen: string; ply: number }[];
  if (rows.length === 0) return 0;

  const movesFor = db.prepare(`
    SELECT m.uci FROM moves m
    WHERE m.game_id = ? AND m.ply <= ?
      AND m.id = (SELECT MAX(previous.id) FROM moves previous
                  WHERE previous.game_id = m.game_id AND previous.ply = m.ply)
    ORDER BY m.ply
  `);
  const update = db.prepare(`UPDATE games SET fen = ?, last_move = ? WHERE id = ?`);
  db.transaction(() => {
    for (const r of rows) {
      const moves = (movesFor.all(r.id, r.ply) as { uci: string }[]).map((m) => m.uci);
      update.run(fenAfterMoves(r.initial_fen, moves, r.variant) ?? r.initial_fen, moves.at(-1) ?? null, r.id);
    }
  })();
  return rows.length;
}