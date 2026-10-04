import type Database from "better-sqlite3";
import { fenAfterMoves } from "@lilchess/shared";
import { latestVersion } from "./migrate.js";

export interface IntegrityIssue {
  check: string;
  detail: string;
}

// Cheap checks run at startup; `deep` also replays every game (use it on demand, e.g. on a backup).
export function checkIntegrity(db: Database.Database, opts: { deep?: boolean } = {}): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  const add = (check: string, detail: string) => issues.push({ check, detail });

  for (const r of db.pragma("integrity_check") as { integrity_check: string }[]) {
    if (r.integrity_check !== "ok") add("sqlite", r.integrity_check);
  }
  for (const r of db.pragma("foreign_key_check") as { table: string; rowid: number; parent: string }[]) {
    add("foreign_key", `${r.table} row ${r.rowid} has no matching row in ${r.parent}`);
  }

  const version = (db.prepare(`SELECT version FROM schema_version`).get() as { version: number } | undefined)?.version ?? 0;
  if (version < latestVersion()) {
    add("schema", `database is at version ${version}, latest is ${latestVersion()} (the server migrates on start)`);
    return issues; // the checks below need the current columns
  }

  // moves 1..ply must exist exactly once (PK guarantees no duplicates, so count + max is enough)
  const mismatched = db.prepare(`
    SELECT g.id, g.ply, COUNT(m.ply) AS n, COALESCE(MAX(m.ply), 0) AS top
    FROM games g LEFT JOIN moves m ON m.game_id = g.id
    GROUP BY g.id HAVING n <> g.ply OR top <> g.ply
  `).all() as { id: string; ply: number; n: number; top: number }[];
  for (const g of mismatched) add("ply", `game ${g.id}: ply ${g.ply} but ${g.n} move rows (max ply ${g.top})`);

  for (const g of db.prepare(`SELECT id FROM games WHERE fen IS NULL`).all() as { id: string }[]) {
    add("fen", `game ${g.id} has no stored position`);
  }

  if (opts.deep) {
    const games = db.prepare(`SELECT id, initial_fen, fen, last_move FROM games`).all() as
      { id: string; initial_fen: string; fen: string | null; last_move: string | null }[];
    const movesFor = db.prepare(`SELECT uci FROM moves WHERE game_id = ? ORDER BY ply`);
    for (const g of games) {
      const moves = (movesFor.all(g.id) as { uci: string }[]).map((m) => m.uci);
      const fen = fenAfterMoves(g.initial_fen, moves);
      if (fen === null) add("replay", `game ${g.id}: moves do not replay from the initial position`);
      else if (fen !== g.fen) add("fen", `game ${g.id}: stored position differs from the replayed one`);
      if ((moves.at(-1) ?? null) !== g.last_move) add("last_move", `game ${g.id}: last_move does not match the moves`);
    }
  }
  return issues;
}