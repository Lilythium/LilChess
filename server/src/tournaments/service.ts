import { randomBytes } from "node:crypto";
import { createGame, roundRobinPairings, type ClockConfig, type RoundRobinPairing, type Variant } from "@lilchess/shared";
import { getDb } from "../db/connection.js";
import { insertGame } from "../db/repositories/games.js";

export class TournamentError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "TournamentError";
  }
}

export interface TournamentConfig {
  name: string;
  description?: string;
  mode: "live" | "correspondence";
  initialMs?: number;
  incrementMs?: number;
  daysPerMove?: number;
  variant: Variant;
  rated: boolean;
  maxPlayers: number;
  startsAt?: number;
  endsAt?: number;
}

export function createTournament(creatorId: number, config: TournamentConfig): string {
  const db = getDb();
  const id = randomBytes(8).toString("hex");
  const now = Date.now();
  db.transaction(() => {
    db.prepare(`
      INSERT INTO tournaments (
        id, created_by, name, description, mode, initial_ms, increment_ms, days_per_move,
        variant, rated, max_players, starts_at, ends_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, creatorId, config.name, config.description?.trim() || null, config.mode,
      config.mode === "live" ? config.initialMs : null,
      config.mode === "live" ? config.incrementMs ?? 0 : null,
      config.mode === "correspondence" ? config.daysPerMove : null,
      config.variant, config.rated ? 1 : 0, config.maxPlayers,
      config.startsAt ?? null, config.endsAt ?? null, now,
    );
    db.prepare(`INSERT INTO tournament_participants (tournament_id, user_id, joined_at) VALUES (?, ?, ?)`)
      .run(id, creatorId, now);
  })();
  return id;
}

export function listTournaments(viewerId: number) {
  const db = getDb();
  return db.prepare(`
        SELECT t.id, t.name, t.description, t.status, t.format, t.mode, t.variant, t.rated,
          t.starts_at AS startsAt, t.ends_at AS endsAt, t.max_players AS maxPlayers,
           t.created_at AS createdAt, COUNT(DISTINCT p.user_id) AS participantCount,
          COUNT(DISTINCT tp.game_id) AS gameCount,
           MAX(CASE WHEN p.user_id = ? THEN 1 ELSE 0 END) AS joined,
           CASE WHEN t.mode = 'live' AND t.status = 'running' THEN (
             SELECT tp.game_id FROM tournament_pairings tp JOIN games g ON g.id = tp.game_id
             WHERE tp.tournament_id = t.id AND g.status = 'started'
               AND (g.white_id = ? OR g.black_id = ?)
             ORDER BY tp.round_number, tp.board_number LIMIT 1
           ) END AS nextGameId
    FROM tournaments t
    LEFT JOIN tournament_participants p ON p.tournament_id = t.id
    LEFT JOIN tournament_pairings tp ON tp.tournament_id = t.id
    GROUP BY t.id
    ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'running' THEN 1 ELSE 2 END, t.created_at DESC
    LIMIT 100
  `).all(viewerId, viewerId, viewerId);
}

export function joinTournament(tournamentId: string, userId: number): void {
  const db = getDb();
  db.transaction(() => {
    const tournament = db.prepare(`SELECT status, max_players FROM tournaments WHERE id = ?`)
      .get(tournamentId) as { status: string; max_players: number } | undefined;
    if (!tournament) throw new TournamentError("Tournament not found", 404);
    if (tournament.status !== "open") throw new TournamentError("Registration is closed", 409);
    const joined = db.prepare(`SELECT 1 FROM tournament_participants WHERE tournament_id = ? AND user_id = ?`)
      .get(tournamentId, userId);
    if (joined) throw new TournamentError("Already registered", 409);
    const count = db.prepare(`SELECT COUNT(*) AS count FROM tournament_participants WHERE tournament_id = ?`)
      .get(tournamentId) as { count: number };
    if (count.count >= tournament.max_players) throw new TournamentError("Tournament is full", 409);
    db.prepare(`INSERT INTO tournament_participants (tournament_id, user_id, joined_at) VALUES (?, ?, ?)`)
      .run(tournamentId, userId, Date.now());
  }).immediate();
}

export function withdrawTournament(tournamentId: string, userId: number): void {
  const db = getDb();
  const tournament = db.prepare(`SELECT status FROM tournaments WHERE id = ?`).get(tournamentId) as
    { status: string } | undefined;
  if (!tournament) throw new TournamentError("Tournament not found", 404);
  if (tournament.status !== "open") throw new TournamentError("Registration is closed", 409);
  const result = db.prepare(`DELETE FROM tournament_participants WHERE tournament_id = ? AND user_id = ?`)
    .run(tournamentId, userId);
  if (result.changes === 0) throw new TournamentError("Not registered", 404);
}

interface TournamentRow {
  id: string;
  created_by: number;
  status: string;
  mode: "live" | "correspondence";
  initial_ms: number | null;
  increment_ms: number | null;
  days_per_move: number | null;
  variant: Variant;
  rated: number;
  starts_at: number | null;
}

function gameClock(tournament: TournamentRow): ClockConfig {
  return tournament.mode === "live"
    ? { mode: "live", initialMs: tournament.initial_ms!, incrementMs: tournament.increment_ms ?? 0 }
    : { mode: "correspondence", daysPerMove: tournament.days_per_move! };
}

function createPairingGame(tournament: TournamentRow, pairing: RoundRobinPairing, now: number): void {
  const db = getDb();
  const gameId = randomBytes(5).toString("hex");
  insertGame(gameId, pairing.whiteId, pairing.blackId, createGame({
    clock: gameClock(tournament), now, variant: tournament.variant, rated: tournament.rated === 1,
  }));
  db.prepare(`
    UPDATE tournament_pairings SET game_id = ?
    WHERE tournament_id = ? AND round_number = ? AND board_number = ? AND game_id IS NULL
  `).run(gameId, tournament.id, pairing.round, pairing.board);
}

function startTournamentInTransaction(tournamentId: string, organizerId: number | null, now: number): number {
  const db = getDb();
  const tournament = db.prepare(`SELECT * FROM tournaments WHERE id = ?`).get(tournamentId) as TournamentRow | undefined;
  if (!tournament) throw new TournamentError("Tournament not found", 404);
  if (organizerId !== null && tournament.created_by !== organizerId) {
    throw new TournamentError("Only the organizer can start this tournament", 403);
  }
  if (tournament.status !== "open") throw new TournamentError("Tournament is not open", 409);
  if (tournament.starts_at !== null && tournament.starts_at > now) {
    throw new TournamentError("Tournament is scheduled to start later", 409);
  }

  const participants = db.prepare(`
    SELECT p.user_id AS id, u.is_guest AS isGuest FROM tournament_participants p
    JOIN users u ON u.id = p.user_id WHERE p.tournament_id = ? ORDER BY p.joined_at, p.user_id
  `).all(tournamentId) as { id: number; isGuest: number }[];
  if (participants.length < 2) throw new TournamentError("At least two players are required", 409);
  if (tournament.rated && participants.some((player) => player.isGuest)) {
    throw new TournamentError("Rated tournaments cannot include guest accounts", 403);
  }

  const pairings = roundRobinPairings(participants.map((player) => player.id));
  db.prepare(`UPDATE tournaments SET status = 'running', started_at = ?, current_round = 1 WHERE id = ?`)
    .run(now, tournamentId);
  for (const pairing of pairings) {
    db.prepare(`
      INSERT INTO tournament_pairings (tournament_id, round_number, board_number, white_id, black_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(tournamentId, pairing.round, pairing.board, pairing.whiteId, pairing.blackId);
  }

  const firstRound = pairings.filter((pairing) => pairing.round === 1);
  const openingPairings = tournament.mode === "live" ? firstRound : pairings;
  for (const pairing of openingPairings) createPairingGame(tournament, pairing, now);
  return openingPairings.length;
}

export function startTournament(tournamentId: string, organizerId: number, now = Date.now()): number {
  return getDb().transaction(() => startTournamentInTransaction(tournamentId, organizerId, now)).immediate();
}

export function startScheduledTournaments(now = Date.now()): string[] {
  const db = getDb();
  const due = db.prepare(`
    SELECT id FROM tournaments WHERE status = 'open' AND starts_at IS NOT NULL AND starts_at <= ? ORDER BY starts_at
  `).all(now) as { id: string }[];
  const started: string[] = [];
  for (const { id } of due) {
    try {
      db.transaction(() => startTournamentInTransaction(id, null, now)).immediate();
      started.push(id);
    } catch (error) {
      if (!(error instanceof TournamentError) || error.message !== "At least two players are required") throw error;
      db.prepare(`UPDATE tournaments SET status = 'cancelled' WHERE id = ? AND status = 'open'`).run(id);
    }
  }
  return started;
}

export function getNextTournamentStartAt(now = Date.now()): number | undefined {
  const row = getDb().prepare(`
    SELECT MIN(starts_at) AS startsAt FROM tournaments
    WHERE status = 'open' AND starts_at IS NOT NULL AND starts_at > ?
  `).get(now) as { startsAt: number | null };
  return row.startsAt ?? undefined;
}

// Called inside the transaction that writes the terminal game state.
export function advanceTournamentAfterGame(gameId: string): boolean {
  const db = getDb();
  const pairing = db.prepare(`
    SELECT p.tournament_id AS tournamentId, p.round_number AS round, t.mode, t.status,
           t.current_round AS currentRound
    FROM tournament_pairings p JOIN tournaments t ON t.id = p.tournament_id
    WHERE p.game_id = ?
  `).get(gameId) as { tournamentId: string; round: number; mode: "live" | "correspondence";
    status: string; currentRound: number } | undefined;
  if (!pairing || pairing.status !== "running") return false;

  if (pairing.mode === "correspondence") {
    const remaining = db.prepare(`
      SELECT 1 FROM tournament_pairings p JOIN games g ON g.id = p.game_id
      WHERE p.tournament_id = ? AND g.status = 'started' LIMIT 1
    `).get(pairing.tournamentId);
    if (!remaining) db.prepare(`UPDATE tournaments SET status = 'completed' WHERE id = ?`).run(pairing.tournamentId);
    return false;
  }

  if (pairing.round !== pairing.currentRound) return false;
  const remaining = db.prepare(`
    SELECT 1 FROM tournament_pairings p JOIN games g ON g.id = p.game_id
    WHERE p.tournament_id = ? AND p.round_number = ? AND g.status = 'started' LIMIT 1
  `).get(pairing.tournamentId, pairing.round);
  if (remaining) return false;

  const nextRound = db.prepare(`
    SELECT MIN(round_number) AS round FROM tournament_pairings
    WHERE tournament_id = ? AND round_number > ?
  `).get(pairing.tournamentId, pairing.round) as { round: number | null };
  if (nextRound.round === null) {
    db.prepare(`UPDATE tournaments SET status = 'completed' WHERE id = ?`).run(pairing.tournamentId);
    return false;
  }

  db.prepare(`UPDATE tournaments SET current_round = ? WHERE id = ?`).run(nextRound.round, pairing.tournamentId);
  const tournament = db.prepare(`SELECT * FROM tournaments WHERE id = ?`).get(pairing.tournamentId) as TournamentRow;
  const pairings = db.prepare(`
    SELECT round_number AS round, board_number AS board, white_id AS whiteId, black_id AS blackId
    FROM tournament_pairings WHERE tournament_id = ? AND round_number = ? AND game_id IS NULL
    ORDER BY board_number
  `).all(pairing.tournamentId, nextRound.round) as RoundRobinPairing[];
  for (const next of pairings) createPairingGame(tournament, next, Date.now());
  return pairings.length > 0;
}

export function cancelTournament(tournamentId: string, organizerId: number): void {
  const result = getDb().prepare(`
    UPDATE tournaments SET status = 'cancelled'
    WHERE id = ? AND created_by = ? AND status = 'open'
  `).run(tournamentId, organizerId);
  if (result.changes) return;
  const tournament = getDb().prepare(`SELECT created_by, status FROM tournaments WHERE id = ?`).get(tournamentId) as
    { created_by: number; status: string } | undefined;
  if (!tournament) throw new TournamentError("Tournament not found", 404);
  if (tournament.created_by !== organizerId) throw new TournamentError("Only the organizer can cancel this tournament", 403);
  throw new TournamentError("Only open tournaments can be cancelled", 409);
}

export function getTournament(tournamentId: string, viewerId: number) {
  const db = getDb();
  const tournament = db.prepare(`SELECT t.*, u.username AS organizer FROM tournaments t JOIN users u ON u.id = t.created_by WHERE t.id = ?`)
    .get(tournamentId) as Record<string, any> | undefined;
  if (!tournament) return undefined;

  const participants = db.prepare(`
    SELECT u.id, u.username, p.joined_at AS joinedAt
    FROM tournament_participants p JOIN users u ON u.id = p.user_id
    WHERE p.tournament_id = ?
  `).all(tournamentId) as { id: number; username: string; joinedAt: number }[];
  const games = db.prepare(`
        SELECT p.round_number AS round, g.id, g.status, g.result, g.termination, g.ended_at AS endedAt,
          g.white_id AS whiteId, wu.username AS whiteName, g.black_id AS blackId, bu.username AS blackName
        FROM tournament_pairings p JOIN games g ON g.id = p.game_id
    JOIN users wu ON wu.id = g.white_id JOIN users bu ON bu.id = g.black_id
        WHERE p.tournament_id = ? ORDER BY p.round_number, p.board_number
  `).all(tournamentId) as { round: number; id: string; status: string; result: string | null;
    whiteId: number; whiteName: string; blackId: number; blackName: string }[];

  const standings = participants.map((participant) => {
    const played = games.filter((game) => game.status === "finished" &&
      (game.whiteId === participant.id || game.blackId === participant.id));
    const points = played.reduce((total, game) => {
      if (game.result === "1/2-1/2") return total + 0.5;
      if ((game.result === "1-0" && game.whiteId === participant.id) ||
          (game.result === "0-1" && game.blackId === participant.id)) return total + 1;
      return total;
    }, 0);
    const wins = played.filter((game) =>
      (game.result === "1-0" && game.whiteId === participant.id) ||
      (game.result === "0-1" && game.blackId === participant.id)).length;
    return { ...participant, points, wins, gamesPlayed: played.length };
  }).sort((a, b) => b.points - a.points || b.wins - a.wins || a.username.localeCompare(b.username));

  return {
    tournament: {
      id: tournament.id, name: tournament.name, description: tournament.description,
      status: tournament.status, format: tournament.format, rated: Boolean(tournament.rated),
      mode: tournament.mode, initialMs: tournament.initial_ms, incrementMs: tournament.increment_ms,
      daysPerMove: tournament.days_per_move, variant: tournament.variant, maxPlayers: tournament.max_players,
      startsAt: tournament.starts_at, endsAt: tournament.ends_at,
      organizer: tournament.organizer, createdAt: tournament.created_at, startedAt: tournament.started_at,
      joined: participants.some((p) => p.id === viewerId), isOrganizer: tournament.created_by === viewerId,
    },
    participants,
    standings,
    games,
  };
}