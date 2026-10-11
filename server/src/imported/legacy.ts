import type Database from "better-sqlite3";

export interface LegacyImport {
  id: string;
  white: string;
  black: string;
  ply: number;
  status: string;
  result: string | null;
}

export function findLegacyImports(db: Database.Database): LegacyImport[] {
  return db.prepare(`
    SELECT g.id, wu.username AS white, bu.username AS black, g.ply, g.status, g.result
    FROM games g
    JOIN users wu ON wu.id = g.white_id
    JOIN users bu ON bu.id = g.black_id
    WHERE g.ply > 0 AND g.fen = g.initial_fen AND g.rated = 0
      AND NOT EXISTS (SELECT 1 FROM rating_history r WHERE r.game_id = g.id)
    ORDER BY g.created_at
  `).all() as LegacyImport[];
}

/** Deletes the games `findLegacyImports` reports, with their moves. Returns how many. */
export function purgeLegacyImports(db: Database.Database): number {
  return db.transaction(() => {
    const ids = findLegacyImports(db).map((g) => g.id);
    const dropMoves = db.prepare(`DELETE FROM moves WHERE game_id = ?`);
    const dropGame = db.prepare(`DELETE FROM games WHERE id = ?`);
    for (const id of ids) {
      dropMoves.run(id);
      dropGame.run(id);
    }
    return ids.length;
  }).immediate();
}