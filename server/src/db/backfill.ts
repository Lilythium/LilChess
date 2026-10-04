import type Database from "better-sqlite3";
import { fenAfterMoves } from "@lilchess/shared";

// Fills games.fen / games.last_move for rows that predate migration 0006. A no-op once everything is filled.
export function backfillPositions(db: Database.Database): number {
  const rows = db.prepare(`SELECT id, initial_fen FROM games WHERE fen IS NULL`).all() as
    { id: string; initial_fen: string }[];
  if (rows.length === 0) return 0;

  const movesFor = db.prepare(`SELECT uci FROM moves WHERE game_id = ? ORDER BY ply`);
  const update = db.prepare(`UPDATE games SET fen = ?, last_move = ? WHERE id = ?`);
  db.transaction(() => {
    for (const r of rows) {
      const moves = (movesFor.all(r.id) as { uci: string }[]).map((m) => m.uci);
      update.run(fenAfterMoves(r.initial_fen, moves) ?? r.initial_fen, moves.at(-1) ?? null, r.id);
    }
  })();
  return rows.length;
}