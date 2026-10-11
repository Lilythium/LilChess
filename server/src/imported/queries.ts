import { createHash, randomBytes } from "node:crypto";
import type { ParsedPgnGame } from "@lilchess/shared";
import { getDb } from "../db/connection.js";

export const MAX_IMPORTED_PER_USER = 1000;

export interface ImportedGameSummary {
  id: string;
  white: string;
  black: string;
  whiteElo: number | null;
  blackElo: number | null;
  event: string | null;
  site: string | null;
  date: string | null;
  variant: "standard" | "chess960";
  timeControl: string | null;
  result: "1-0" | "0-1" | "1/2-1/2" | "*";
  termination: string | null;
  fen: string;
  lastMove: string | null;
  plies: number;
  importedAt: number;
}

export interface ImportedGameDetail extends ImportedGameSummary {
  initialFen: string;
  moves: string[]; // UCI
  sans: string[];
}

interface Row {
  id: string;
  white_name: string;
  black_name: string;
  white_elo: number | null;
  black_elo: number | null;
  event: string | null;
  site: string | null;
  played_on: string | null;
  time_control: string | null;
  termination: string | null;
  variant: "standard" | "chess960";
  result: "1-0" | "0-1" | "1/2-1/2" | "*";
  initial_fen: string;
  fen: string;
  last_move: string | null;
  ply: number;
  created_at: number;
}

const COLUMNS = `id, white_name, black_name, white_elo, black_elo, event, site, played_on, time_control,
  termination, variant, result, initial_fen, fen, last_move, ply, created_at`;

function summarise(r: Row): ImportedGameSummary {
  return {
    id: r.id,
    white: r.white_name,
    black: r.black_name,
    whiteElo: r.white_elo,
    blackElo: r.black_elo,
    event: r.event,
    site: r.site,
    date: r.played_on,
    variant: r.variant,
    timeControl: r.time_control,
    result: r.result,
    termination: r.termination,
    fen: r.fen,
    lastMove: r.last_move,
    plies: r.ply,
    importedAt: r.created_at,
  };
}

/** Same game, same owner => same hash. Players and date are part of it, so two different games of one line don't collide. */
function contentHash(g: ParsedPgnGame): string {
  return createHash("sha256")
    .update(JSON.stringify([g.variant, g.initialFen, g.moves, g.white, g.black, g.date, g.result]))
    .digest("hex");
}

export interface ImportOutcome {
  imported: string[]; // ids of the new games, in file order
  duplicates: number; // already imported by this user
  overLimit: number; // not imported because the user is at their cap
}

/** Saves parsed games for `ownerId` in one transaction. Never touches users or the real games tables. */
export function saveImportedGames(
  ownerId: number,
  games: ParsedPgnGame[],
  opts: { now?: number; maxPerUser?: number } = {},
): ImportOutcome {
  const db = getDb();
  const now = opts.now ?? Date.now();
  const cap = opts.maxPerUser ?? MAX_IMPORTED_PER_USER;

  return db.transaction((): ImportOutcome => {
    const out: ImportOutcome = { imported: [], duplicates: 0, overLimit: 0 };
    let held = (db.prepare(`SELECT COUNT(*) FROM imported_games WHERE owner_id = ?`).pluck().get(ownerId) as number);

    const insertGame = db.prepare(`
      INSERT INTO imported_games (
        id, owner_id, white_name, black_name, white_elo, black_elo, event, site, played_on, time_control,
        termination, variant, result, initial_fen, fen, last_move, ply, content_hash, created_at
      ) VALUES (
        @id, @ownerId, @white, @black, @whiteElo, @blackElo, @event, @site, @date, @timeControl,
        @termination, @variant, @result, @initialFen, @fen, @lastMove, @ply, @hash, @now
      ) ON CONFLICT (owner_id, content_hash) DO NOTHING`);
    const insertMove = db.prepare(`INSERT INTO imported_moves (game_id, ply, uci, san) VALUES (?, ?, ?, ?)`);

    for (const g of games) {
      if (held >= cap) {
        out.overLimit++;
        continue;
      }
      const id = randomBytes(5).toString("hex");
      const info = insertGame.run({
        id, ownerId, white: g.white, black: g.black, whiteElo: g.whiteElo, blackElo: g.blackElo,
        event: g.event, site: g.site, date: g.date, timeControl: g.timeControl, termination: g.termination,
        variant: g.variant, result: g.result, initialFen: g.initialFen, fen: g.finalFen,
        lastMove: g.moves.at(-1) ?? null, ply: g.moves.length, hash: contentHash(g), now,
      });
      if (info.changes === 0) {
        out.duplicates++;
        continue;
      }
      g.moves.forEach((uci, i) => insertMove.run(id, i + 1, uci, g.sans[i]));
      out.imported.push(id);
      held++;
    }
    return out;
  }).immediate();
}

export function listImportedGames(ownerId: number, limit: number, offset: number): ImportedGameSummary[] {
  const rows = getDb()
    .prepare(`SELECT ${COLUMNS} FROM imported_games WHERE owner_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`)
    .all(ownerId, limit, offset) as Row[];
  return rows.map(summarise);
}

export function countImportedGames(ownerId: number): number {
  return getDb().prepare(`SELECT COUNT(*) FROM imported_games WHERE owner_id = ?`).pluck().get(ownerId) as number;
}

/** Only the owner can read an imported game. */
export function getImportedGame(ownerId: number, id: string): ImportedGameDetail | undefined {
  const db = getDb();
  const row = db.prepare(`SELECT ${COLUMNS} FROM imported_games WHERE id = ? AND owner_id = ?`).get(id, ownerId) as Row | undefined;
  if (!row) return undefined;
  const moves = db.prepare(`SELECT uci, san FROM imported_moves WHERE game_id = ? ORDER BY ply`).all(id) as { uci: string; san: string }[];
  return { ...summarise(row), initialFen: row.initial_fen, moves: moves.map((m) => m.uci), sans: moves.map((m) => m.san) };
}

export function deleteImportedGame(ownerId: number, id: string): boolean {
  return getDb().prepare(`DELETE FROM imported_games WHERE id = ? AND owner_id = ?`).run(id, ownerId).changes > 0;
}