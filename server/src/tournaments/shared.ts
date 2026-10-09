import { randomBytes } from "node:crypto";
import {
  createGame, type ClockConfig, type ScoredGame, type StandingPlayer, type TournamentFormat, type UserEvent, type Variant,
} from "@lilchess/shared";
import { getDb } from "../db/connection.js";
import { insertGame } from "../db/repositories/insertGame.js";
import { broadcastUserEvent } from "../ws/hub.js";

export class TournamentError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "TournamentError";
  }
}

// WebSocket pushes are queued while a transaction is open and sent only after it commits.
export const pendingUserEvents: { userId: number; event: UserEvent }[] = [];

export function flushTournamentEvents(): void {
  for (const { userId, event } of pendingUserEvents.splice(0)) broadcastUserEvent(userId, event);
}

export interface TournamentRow {
  id: string;
  created_by: number;
  status: string;
  format: TournamentFormat;
  mode: "live" | "correspondence";
  initial_ms: number | null;
  increment_ms: number | null;
  days_per_move: number | null;
  variant: Variant;
  rated: number;
  started_at: number | null;
  starts_at: number | null;
  ends_at: number | null;
  current_round: number;
  rounds: number | null;
  duration_ms: number | null;
  streak_bonus: number;
}

export function loadTournament(id: string): TournamentRow | undefined {
  return getDb().prepare(`SELECT * FROM tournaments WHERE id = ?`).get(id) as TournamentRow | undefined;
}

function gameClock(tournament: TournamentRow): ClockConfig {
  return tournament.mode === "live"
    ? { mode: "live", initialMs: tournament.initial_ms!, incrementMs: tournament.increment_ms ?? 0 }
    : { mode: "correspondence", daysPerMove: tournament.days_per_move! };
}

/** Creates the game for a pairing and queues "pairing_ready" for live tournaments. Returns the game id. */
export function startPairingGame(tournament: TournamentRow, whiteId: number, blackId: number, round: number, now: number): string {
  const gameId = randomBytes(5).toString("hex");
  insertGame(gameId, whiteId, blackId, createGame({
    clock: gameClock(tournament), now, variant: tournament.variant, rated: tournament.rated === 1,
  }));
  if (tournament.mode === "live") {
    const event: UserEvent = { type: "pairing_ready", tournamentId: tournament.id, gameId, round };
    pendingUserEvents.push({ userId: whiteId, event }, { userId: blackId, event });
  }
  return gameId;
}

export interface NewPairing {
  round: number;
  board: number;
  whiteId: number;
  blackId: number;
  match?: number;
  leg?: number;
}

/** Inserts a pairing row together with its game (swiss, knockout and arena create rows as they go). */
export function insertPairingWithGame(tournament: TournamentRow, pairing: NewPairing, now: number): string {
  const gameId = startPairingGame(tournament, pairing.whiteId, pairing.blackId, pairing.round, now);
  getDb().prepare(`
    INSERT INTO tournament_pairings (tournament_id, round_number, board_number, white_id, black_id, game_id, match_number, leg)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(tournament.id, pairing.round, pairing.board, pairing.whiteId, pairing.blackId, gameId, pairing.match ?? null, pairing.leg ?? 1);
  return gameId;
}

export function insertBye(tournamentId: string, round: number, board: number, playerId: number, match?: number): void {
  getDb().prepare(`
    INSERT INTO tournament_pairings (tournament_id, round_number, board_number, white_id, black_id, is_bye, match_number)
    VALUES (?, ?, ?, ?, NULL, 1, ?)
  `).run(tournamentId, round, board, playerId, match ?? null);
}

export function nextBoardNumber(tournamentId: string, round: number): number {
  const row = getDb().prepare(`
    SELECT COALESCE(MAX(board_number), 0) + 1 AS board FROM tournament_pairings WHERE tournament_id = ? AND round_number = ?
  `).get(tournamentId, round) as { board: number };
  return row.board;
}

/** Fixes seeds at the start: best rating (for the tournament's variant) first, then join order. */
export function assignSeeds(tournament: TournamentRow): StandingPlayer[] {
  const db = getDb();
  const ordered = db.prepare(`
    SELECT p.user_id AS id FROM tournament_participants p
    LEFT JOIN ratings r ON r.user_id = p.user_id AND r.variant = ?
    WHERE p.tournament_id = ?
    ORDER BY COALESCE(r.rating, 1500) DESC, p.joined_at, p.user_id
  `).all(tournament.variant, tournament.id) as { id: number }[];
  const update = db.prepare(`UPDATE tournament_participants SET seed = ? WHERE tournament_id = ? AND user_id = ?`);
  return ordered.map(({ id }, index) => {
    update.run(index + 1, tournament.id, id);
    return { id, seed: index + 1 };
  });
}

export interface ParticipantRow extends StandingPlayer {
  paused: boolean;
  username: string;
}

export function loadParticipants(tournamentId: string): ParticipantRow[] {
  const rows = getDb().prepare(`
    SELECT p.user_id AS id, u.username, p.paused, p.seed, p.joined_at
    FROM tournament_participants p JOIN users u ON u.id = p.user_id
    WHERE p.tournament_id = ?
    ORDER BY COALESCE(p.seed, 1000000), p.joined_at, p.user_id
  `).all(tournamentId) as { id: number; username: string; paused: number; seed: number | null }[];
  return rows.map((row, index) => ({ id: row.id, username: row.username, paused: row.paused === 1, seed: row.seed ?? index + 1 }));
}

/** Every scoring result in a tournament, in the shape the standings code wants. */
export function loadScoredGames(tournamentId: string): ScoredGame[] {
  const rows = getDb().prepare(`
    SELECT p.round_number AS round, p.white_id AS whiteId, p.black_id AS blackId, p.forfeit_by AS forfeitBy,
           p.voided, p.is_bye AS isBye, g.status, g.result, g.ended_at AS endedAt
    FROM tournament_pairings p LEFT JOIN games g ON g.id = p.game_id
    WHERE p.tournament_id = ? ORDER BY p.round_number, p.board_number
  `).all(tournamentId) as {
    round: number; whiteId: number; blackId: number | null; forfeitBy: number | null; voided: number;
    isBye: number; status: string | null; result: ScoredGame["result"]; endedAt: number | null;
  }[];

  const scored: ScoredGame[] = [];
  for (const row of rows) {
    const at = row.endedAt ?? undefined;
    if (row.isBye) {
      scored.push({ round: row.round, whiteId: row.whiteId, blackId: null, result: null, bye: true });
    } else if (row.voided) {
      continue;
    } else if (row.forfeitBy !== null) {
      scored.push({ round: row.round, whiteId: row.whiteId, blackId: row.blackId, result: row.forfeitBy === row.whiteId ? "0-1" : "1-0", at });
    } else if (row.status === "finished" && row.result) {
      scored.push({ round: row.round, whiteId: row.whiteId, blackId: row.blackId, result: row.result, at });
    }
  }
  return scored;
}

export function hasStartedGame(tournamentId: string, round?: number): boolean {
  const row = getDb().prepare(`
    SELECT 1 FROM tournament_pairings p JOIN games g ON g.id = p.game_id
    WHERE p.tournament_id = ? AND g.status = 'started' ${round === undefined ? "" : "AND p.round_number = ?"} LIMIT 1
  `).get(...(round === undefined ? [tournamentId] : [tournamentId, round]));
  return row !== undefined;
}

export function completeTournament(tournamentId: string): void {
  getDb().prepare(`UPDATE tournaments SET status = 'completed' WHERE id = ? AND status = 'running'`).run(tournamentId);
}
