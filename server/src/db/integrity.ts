import type Database from "better-sqlite3";
import { fensForMoves, VARIANTS, type Variant } from "@lilchess/shared";
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

  // active_moves contains the current line; older rows remain in moves as takeback history.
  const mismatched = db.prepare(`
    SELECT g.id, g.ply,
      COUNT(a.ply) AS n, COALESCE(MAX(a.ply), 0) AS top
    FROM games g LEFT JOIN active_moves a ON a.game_id = g.id
    GROUP BY g.id
    HAVING COUNT(a.ply) <> g.ply OR COALESCE(MAX(a.ply), 0) <> g.ply
  `).all() as { id: string; ply: number; n: number; top: number }[];
  
  for (const g of mismatched) add("ply", `game ${g.id}: ply ${g.ply} but ${g.n} move rows (max ply ${g.top})`);
    const importedMismatch = db.prepare(`
    SELECT g.id, g.ply, COUNT(m.ply) AS n, COALESCE(MAX(m.ply), 0) AS top
    FROM imported_games g LEFT JOIN imported_moves m ON m.game_id = g.id
    GROUP BY g.id HAVING n <> g.ply OR top <> g.ply
  `).all() as { id: string; ply: number; n: number; top: number }[];
  for (const g of importedMismatch) add("imported", `imported game ${g.id}: ply ${g.ply} but ${g.n} move rows (max ply ${g.top})`);

  for (const g of db.prepare(`SELECT id FROM games WHERE fen IS NULL`).all() as { id: string }[]) {
    add("fen", `game ${g.id} has no stored position`);
  }

  const marks = VARIANTS.map(() => "?").join(",");
  for (const g of db.prepare(`SELECT id, variant FROM games WHERE variant NOT IN (${marks})`).all(...VARIANTS) as
    { id: string; variant: string }[]) {
    add("variant", `game ${g.id} has unknown variant '${g.variant}'`);
  }

  for (const r of db.prepare(`
    SELECT sp.simul_id AS simulId, sp.user_id AS userId FROM simul_players sp JOIN simuls s ON s.id = sp.simul_id
    WHERE s.status IN ('running', 'completed') AND sp.status = 'accepted' AND sp.game_id IS NULL
  `).all() as { simulId: string; userId: number }[]) {
    add("simul", `simul ${r.simulId}: accepted player ${r.userId} has no board`);
  }
  for (const r of db.prepare(`
    SELECT s.id AS simulId, g.id AS gameId FROM simul_players sp
    JOIN simuls s ON s.id = sp.simul_id JOIN games g ON g.id = sp.game_id
    WHERE g.white_id <> s.host_id AND g.black_id <> s.host_id
  `).all() as { simulId: string; gameId: string }[]) {
    add("simul", `simul ${r.simulId}: game ${r.gameId} does not include the host`);
  }
  for (const r of db.prepare(`
    SELECT s.id FROM simuls s WHERE s.status = 'running' AND NOT EXISTS (
      SELECT 1 FROM simul_players sp JOIN games g ON g.id = sp.game_id WHERE sp.simul_id = s.id AND g.status = 'started')
  `).all() as { id: string }[]) {
    add("simul", `simul ${r.id} is running but has no game in progress`);
  }

  if (opts.deep) {
    const games = db.prepare(`SELECT id, variant, initial_fen, fen, last_move, ply FROM games`).all() as
      { id: string; variant: Variant; initial_fen: string; fen: string | null; last_move: string | null; ply: number }[];
    const movesFor = db.prepare(`
      SELECT m.uci FROM active_moves a
      JOIN moves m ON m.id = a.move_id
      WHERE a.game_id = ? ORDER BY a.ply
    `);
    // Only checkpoints still tied to a live move; retracted ones are ignored by the loader.
    const snapshotsFor = db.prepare(`
      SELECT s.ply, s.fen FROM game_snapshots s
      JOIN active_moves a ON a.game_id = s.game_id AND a.ply = s.ply AND a.move_id = s.move_id
      WHERE s.game_id = ?
    `);
    for (const g of games) {
      const moves = (movesFor.all(g.id) as { uci: string }[]).map((m) => m.uci);
      const fens = fensForMoves(g.initial_fen, moves, g.variant);
      const fen = fens?.at(-1) ?? null;
      if (fen === null) add("replay", `game ${g.id}: moves do not replay from the initial position`);
      else if (fen !== g.fen) add("fen", `game ${g.id}: stored position differs from the replayed one`);
      if ((moves.at(-1) ?? null) !== g.last_move) add("last_move", `game ${g.id}: last_move does not match the moves`);
      if (fens) {
        for (const s of snapshotsFor.all(g.id) as { ply: number; fen: string }[]) {
          if (fens[s.ply] !== s.fen) add("snapshot", `game ${g.id}: checkpoint at ply ${s.ply} differs from the replayed position`);
        }
      }
    }
  }
  return issues;
}