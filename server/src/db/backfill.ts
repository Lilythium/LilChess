import type Database from "better-sqlite3";
import { parseUci } from "chessops/util";
import {
  fenAfterMoves,
  fenOf,
  makeSeed,
  positionFromFen,
  positionKey,
  SNAPSHOT_INTERVAL,
  type Variant,
} from "@lilchess/shared";

// Fills games.fen / games.last_move for rows that predate migration 0006. A no-op once everything is filled.
export function backfillPositions(db: Database.Database): number {
  const rows = db.prepare(`SELECT id, variant, initial_fen, ply FROM games WHERE fen IS NULL`).all() as
    { id: string; variant: Variant; initial_fen: string; ply: number }[];
  if (rows.length === 0) return 0;

  const movesFor = db.prepare(`
    SELECT m.uci FROM active_moves a
    JOIN moves m ON m.id = a.move_id
    WHERE a.game_id = ? ORDER BY a.ply
  `);
  const update = db.prepare(`UPDATE games SET fen = ?, last_move = ? WHERE id = ?`);
  db.transaction(() => {
    for (const r of rows) {
      const moves = (movesFor.all(r.id) as { uci: string }[]).map((m) => m.uci);
      update.run(fenAfterMoves(r.initial_fen, moves, r.variant) ?? r.initial_fen, moves.at(-1) ?? null, r.id);
    }
  })();
  return rows.length;
}

// Games already in progress when snapshots shipped have none. Replay each once and store a checkpoint at every
// SNAPSHOT_INTERVAL plies so their next move is as cheap as a new game's. Finished games never move again, so
// they are left alone. A no-op once every long running game has a checkpoint.
export function backfillSnapshots(db: Database.Database): number {
  const games = db.prepare(`
    SELECT g.id, g.variant, g.initial_fen FROM games g
    WHERE g.status = 'started' AND g.ply >= ?
      AND NOT EXISTS (SELECT 1 FROM game_snapshots s WHERE s.game_id = g.id)
  `).all(SNAPSHOT_INTERVAL) as { id: string; variant: Variant; initial_fen: string }[];
  if (games.length === 0) return 0;

  const movesFor = db.prepare(`
    SELECT a.move_id AS moveId, m.uci FROM active_moves a
    JOIN moves m ON m.id = a.move_id
    WHERE a.game_id = ? ORDER BY a.ply
  `);
  const insert = db.prepare(
    `INSERT OR REPLACE INTO game_snapshots (game_id, ply, move_id, fen, keys) VALUES (?, ?, ?, ?, ?)`,
  );

  let filled = 0;
  db.transaction(() => {
    for (const g of games) {
      try {
        const rows = movesFor.all(g.id) as { moveId: number; uci: string }[];
        const pos = positionFromFen(g.initial_fen, g.variant);
        const keys = [positionKey(pos)];
        const pending: [number, number, string, string[]][] = [];
        let ok = true;
        for (let i = 0; i < rows.length; i++) {
          const move = parseUci(rows[i]!.uci);
          if (!move || !pos.isLegal(move)) { ok = false; break; }
          pos.play(move);
          keys.push(positionKey(pos));
          const ply = i + 1;
          if (ply % SNAPSHOT_INTERVAL === 0) {
            const seed = makeSeed(fenOf(pos), pos.halfmoves, ply, keys);
            pending.push([ply, rows[i]!.moveId, seed.fen, seed.keys]);
          }
        }
        if (!ok) continue; // leave it to integrity checking; moves fall back to the full replay
        for (const [ply, moveId, fen, k] of pending) insert.run(g.id, ply, moveId, fen, k.join("\n"));
        filled++;
      } catch {
        // unreadable position: no checkpoints, full replay still works
      }
    }
  })();
  return filled;
}
