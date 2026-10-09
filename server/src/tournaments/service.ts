import { randomBytes } from "node:crypto";
import {
  computeStandings, knockoutRoundCount, matchOutcome, roundRobinPairings,
  type Leg, type StandingRow, type TournamentFormat, type Variant,
} from "@lilchess/shared";
import { getDb } from "../db/connection.js";
import { logger } from "../logger.js";
import {
  assignSeeds, completeTournament, flushTournamentEvents, hasStartedGame, loadParticipants, loadScoredGames,
  loadTournament, pendingUserEvents, startPairingGame, TournamentError, type TournamentRow,
} from "./shared.js";
import {
  repairRound, startKnockoutFirstRound, startNextRound, startSwissRound, swissTotalRounds,
} from "./rounds.js";

export { flushTournamentEvents, TournamentError } from "./shared.js";

const log = logger.child({ mod: "tournaments" });

export const MAX_ACTIVE_TOURNAMENTS_PER_USER = 3;
export const MAX_PLAYERS: Record<TournamentFormat, number> = { round_robin: 16, swiss: 64, knockout: 64, arena: 64 };

export interface TournamentConfig {
  name: string;
  description?: string;
  format?: TournamentFormat;
  mode: "live" | "correspondence";
  initialMs?: number;
  incrementMs?: number;
  daysPerMove?: number;
  variant: Variant;
  rated: boolean;
  maxPlayers: number;
  startsAt?: number;
  endsAt?: number;
  /** Swiss: number of rounds (default ceil(log2 n)). */
  rounds?: number;
  /** Arena: how long it runs once started. */
  durationMs?: number;
  /** Arena: two wins in a row make the next game worth double. */
  streakBonus?: boolean;
}

export function createTournament(creatorId: number, config: TournamentConfig): string {
  const db = getDb();
  const format = config.format ?? "round_robin";
  if (config.maxPlayers > MAX_PLAYERS[format]) {
    throw new TournamentError(`A ${format.replace("_", " ")} can have at most ${MAX_PLAYERS[format]} players`, 400);
  }
  if (format === "arena" && (config.mode !== "live" || !config.durationMs)) {
    throw new TournamentError("Arenas are live-only and need a duration", 400);
  }
  const id = randomBytes(8).toString("hex");
  const now = Date.now();
  db.transaction(() => {
    const active = db.prepare(`
      SELECT COUNT(*) AS n FROM tournaments WHERE created_by = ? AND status IN ('open', 'running')
    `).get(creatorId) as { n: number };
    if (active.n >= MAX_ACTIVE_TOURNAMENTS_PER_USER) {
      throw new TournamentError(`You can have at most ${MAX_ACTIVE_TOURNAMENTS_PER_USER} active tournaments`, 409);
    }
    db.prepare(`
      INSERT INTO tournaments (
        id, created_by, name, description, format, mode, initial_ms, increment_ms, days_per_move,
        variant, rated, max_players, rounds, duration_ms, streak_bonus, starts_at, ends_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, creatorId, config.name, config.description?.trim() || null, format, config.mode,
      config.mode === "live" ? config.initialMs : null,
      config.mode === "live" ? config.incrementMs ?? 0 : null,
      config.mode === "correspondence" ? config.daysPerMove : null,
      config.variant, config.rated ? 1 : 0, config.maxPlayers,
      format === "swiss" ? config.rounds ?? null : null,
      format === "arena" ? config.durationMs : null,
      config.streakBonus === false ? 0 : 1,
      config.startsAt ?? null,
      // Arenas get their end time when they start; the other formats just show the planned end.
      format === "arena" ? null : config.endsAt ?? null,
      now,
    );
    db.prepare(`INSERT INTO tournament_participants (tournament_id, user_id, joined_at) VALUES (?, ?, ?)`)
      .run(id, creatorId, now);
  }).immediate();
  return id;
}

export function listTournaments(viewerId: number) {
  return getDb().prepare(`
    SELECT t.id, t.name, t.description, t.status, t.format, t.mode, t.variant, t.rated,
           t.starts_at AS startsAt, t.ends_at AS endsAt, t.max_players AS maxPlayers,
           t.created_at AS createdAt, t.duration_ms AS durationMs, t.rounds, t.current_round AS currentRound,
           (SELECT COUNT(*) FROM tournament_participants p WHERE p.tournament_id = t.id) AS participantCount,
           (SELECT COUNT(*) FROM tournament_pairings tp WHERE tp.tournament_id = t.id AND tp.game_id IS NOT NULL) AS gameCount,
           EXISTS (SELECT 1 FROM tournament_participants p WHERE p.tournament_id = t.id AND p.user_id = @viewer) AS joined,
           CASE WHEN t.mode = 'live' AND t.status = 'running' THEN (
             SELECT tp.game_id FROM tournament_pairings tp JOIN games g ON g.id = tp.game_id
             WHERE tp.tournament_id = t.id AND g.status = 'started'
               AND (g.white_id = @viewer OR g.black_id = @viewer)
             ORDER BY tp.round_number, tp.board_number LIMIT 1
           ) END AS nextGameId
    FROM tournaments t
    ORDER BY CASE t.status WHEN 'running' THEN 0 WHEN 'open' THEN 1 ELSE 2 END, COALESCE(t.starts_at, t.created_at) DESC
    LIMIT 100
  `).all({ viewer: viewerId });
}

export function joinTournament(tournamentId: string, userId: number, now = Date.now()): void {
  const db = getDb();
  db.transaction(() => {
    const tournament = loadTournament(tournamentId);
    if (!tournament) throw new TournamentError("Tournament not found", 404);
    // Arenas stay open for joining until they end; every other format closes at the start.
    const lateJoin = tournament.format === "arena" && tournament.status === "running" && (tournament.ends_at ?? 0) > now;
    if (tournament.status !== "open" && !lateJoin) throw new TournamentError("Registration is closed", 409);
    const joined = db.prepare(`SELECT 1 FROM tournament_participants WHERE tournament_id = ? AND user_id = ?`)
      .get(tournamentId, userId);
    if (joined) throw new TournamentError("Already registered", 409);
    const count = db.prepare(`SELECT COUNT(*) AS count, COALESCE(MAX(seed), 0) AS maxSeed FROM tournament_participants WHERE tournament_id = ?`)
      .get(tournamentId) as { count: number; maxSeed: number };
    const max = (db.prepare(`SELECT max_players FROM tournaments WHERE id = ?`).get(tournamentId) as { max_players: number }).max_players;
    if (count.count >= max) throw new TournamentError("Tournament is full", 409);
    db.prepare(`INSERT INTO tournament_participants (tournament_id, user_id, joined_at, seed) VALUES (?, ?, ?, ?)`)
      .run(tournamentId, userId, now, lateJoin ? count.maxSeed + 1 : null);
  }).immediate();
}

export function withdrawTournament(tournamentId: string, userId: number): void {
  const db = getDb();
  const tournament = loadTournament(tournamentId);
  if (!tournament) throw new TournamentError("Tournament not found", 404);
  if (tournament.status !== "open") throw new TournamentError("Registration is closed", 409);
  const result = db.prepare(`DELETE FROM tournament_participants WHERE tournament_id = ? AND user_id = ?`)
    .run(tournamentId, userId);
  if (result.changes === 0) throw new TournamentError("Not registered", 404);
}

/** Sit out: an arena stops pairing you after your current game, a swiss skips you from the next round. */
export function pauseTournament(tournamentId: string, userId: number): void {
  const db = getDb();
  db.transaction(() => {
    const tournament = loadTournament(tournamentId);
    if (!tournament) throw new TournamentError("Tournament not found", 404);
    if (tournament.status !== "running") throw new TournamentError("Tournament is not running", 409);
    if (tournament.format !== "arena" && tournament.format !== "swiss") {
      throw new TournamentError("You can only pause in arena and swiss tournaments", 409);
    }
    const result = db.prepare(`
      UPDATE tournament_participants SET paused = 1 WHERE tournament_id = ? AND user_id = ? AND paused = 0
    `).run(tournamentId, userId);
    if (result.changes === 0) throw new TournamentError("You are not playing in this tournament", 409);
  }).immediate();
}

// Lets a paused player back into the pairings from the next round (or, in an arena, straight away).
export function resumeTournament(tournamentId: string, userId: number): void {
  const db = getDb();
  db.transaction(() => {
    const tournament = loadTournament(tournamentId);
    if (!tournament) throw new TournamentError("Tournament not found", 404);
    if (tournament.status !== "running") throw new TournamentError("Tournament is not running", 409);
    const result = db.prepare(`
      UPDATE tournament_participants SET paused = 0 WHERE tournament_id = ? AND user_id = ? AND paused = 1
    `).run(tournamentId, userId);
    if (result.changes === 0) throw new TournamentError("You are not paused in this tournament", 409);
  }).immediate();
}

function startTournamentInTransaction(tournamentId: string, organizerId: number | null, now: number): number {
  const db = getDb();
  const tournament = loadTournament(tournamentId);
  if (!tournament) throw new TournamentError("Tournament not found", 404);
  if (organizerId !== null && tournament.created_by !== organizerId) {
    throw new TournamentError("Only the organizer can start this tournament", 403);
  }
  if (tournament.status !== "open") throw new TournamentError("Tournament is not open", 409);
  if (tournament.starts_at !== null && tournament.starts_at > now) {
    throw new TournamentError("Tournament is scheduled to start later", 409);
  }

  const guests = db.prepare(`
    SELECT COUNT(*) AS n FROM tournament_participants p JOIN users u ON u.id = p.user_id
    WHERE p.tournament_id = ? AND u.is_guest = 1
  `).get(tournamentId) as { n: number };
  const count = db.prepare(`SELECT COUNT(*) AS n FROM tournament_participants WHERE tournament_id = ?`).get(tournamentId) as { n: number };
  if (count.n < (tournament.format === "arena" ? 1 : 2)) {
    throw new TournamentError(tournament.format === "arena" ? "At least one player is required" : "At least two players are required", 409);
  }
  if (tournament.rated && guests.n > 0) {
    throw new TournamentError("Rated tournaments cannot include guest accounts", 403);
  }

  const seeded = assignSeeds(tournament);
  const idsBySeed = seeded.map((player) => player.id);
  const markRunning = (rounds: number | null, endsAt: number | null) =>
    db.prepare(`
      UPDATE tournaments SET status = 'running', started_at = ?, current_round = 1, rounds = ?, ends_at = COALESCE(?, ends_at)
      WHERE id = ?
    `).run(now, rounds, endsAt, tournamentId);
  const running = () => ({ ...tournament, status: "running", started_at: now } as TournamentRow);

  switch (tournament.format) {
    case "arena":
      // Games are paired by the scheduler as players become free.
      markRunning(null, now + tournament.duration_ms!);
      return 0;

    case "swiss": {
      const rounds = swissTotalRounds(tournament.rounds, idsBySeed.length);
      markRunning(rounds, null);
      return startSwissRound({ ...running(), rounds }, 1);
    }

    case "knockout": {
      const rounds = knockoutRoundCount(idsBySeed.length);
      markRunning(rounds, null);
      return startKnockoutFirstRound({ ...running(), rounds }, idsBySeed);
    }

    case "round_robin": {
      const pairings = roundRobinPairings(idsBySeed);
      markRunning(Math.max(...pairings.map((pairing) => pairing.round)), null);
      for (const pairing of pairings) {
        db.prepare(`
          INSERT INTO tournament_pairings (tournament_id, round_number, board_number, white_id, black_id)
          VALUES (?, ?, ?, ?, ?)
        `).run(tournamentId, pairing.round, pairing.board, pairing.whiteId, pairing.blackId);
      }
      // Live: round 1 now, the rest as rounds finish. Correspondence: every game at once.
      const opening = tournament.mode === "live" ? pairings.filter((pairing) => pairing.round === 1) : pairings;
      for (const pairing of opening) {
        const gameId = startPairingGame(tournament, pairing.whiteId, pairing.blackId, pairing.round, now);
        db.prepare(`
          UPDATE tournament_pairings SET game_id = ?
          WHERE tournament_id = ? AND round_number = ? AND board_number = ? AND game_id IS NULL
        `).run(gameId, tournamentId, pairing.round, pairing.board);
      }
      return opening.length;
    }
  }
}

export function startTournament(tournamentId: string, organizerId: number, now = Date.now()): number {
  try {
    const count = getDb().transaction(() => startTournamentInTransaction(tournamentId, organizerId, now)).immediate();
    flushTournamentEvents();
    return count;
  } catch (error) {
    pendingUserEvents.length = 0; // nothing was committed
    throw error;
  }
}

export function startScheduledTournaments(now = Date.now()): { started: string[]; cancelled: string[] } {
  const db = getDb();
  const due = db.prepare(`
    SELECT id FROM tournaments WHERE status = 'open' AND starts_at IS NOT NULL AND starts_at <= ? ORDER BY starts_at
  `).all(now) as { id: string }[];
  const started: string[] = [];
  const cancelled: string[] = [];
  for (const { id } of due) {
    try {
      db.transaction(() => startTournamentInTransaction(id, null, now)).immediate();
      started.push(id);
    } catch (error) {
      pendingUserEvents.length = 0; // nothing from the failed start was committed
      if (!(error instanceof TournamentError)) {
        log.error({ err: error, tournamentId: id }, "scheduled tournament failed to start");
      }
      // Cancel rather than retry: a tournament that can't start must not block the ones behind it.
      const result = db.prepare(`UPDATE tournaments SET status = 'cancelled' WHERE id = ? AND status = 'open'`).run(id);
      if (result.changes) cancelled.push(id);
    }
  }
  flushTournamentEvents();
  return { started, cancelled };
}

export function getNextTournamentStartAt(now = Date.now()): number | undefined {
  const row = getDb().prepare(`
    SELECT MIN(starts_at) AS startsAt FROM tournaments
    WHERE status = 'open' AND starts_at IS NOT NULL AND starts_at > ?
  `).get(now) as { startsAt: number | null };
  return row.startsAt ?? undefined;
}

export function advanceTournamentAfterGame(gameId: string, noShowId: number | null = null, now = Date.now()): boolean {
  const db = getDb();
  const pairing = db.prepare(`
    SELECT p.tournament_id AS tournamentId, p.round_number AS round FROM tournament_pairings p WHERE p.game_id = ?
  `).get(gameId) as { tournamentId: string; round: number } | undefined;
  if (!pairing) return false;
  const tournament = loadTournament(pairing.tournamentId);
  if (!tournament || tournament.status !== "running") return false;

  if (noShowId !== null) {
    const forfeited = db.prepare(`
      UPDATE tournament_pairings SET forfeit_by = ?
      WHERE game_id = ? AND (white_id = ? OR black_id = ?)
    `).run(noShowId, gameId, noShowId, noShowId).changes;
    // Live players who never showed up are paused so they stop being paired (they can resume).
    if (forfeited && tournament.mode === "live") {
      db.prepare(`UPDATE tournament_participants SET paused = 1 WHERE tournament_id = ? AND user_id = ?`)
        .run(tournament.id, noShowId);
    }
  }

  if (tournament.format === "arena") {
    // New pairings come from the scheduler; here we only close the arena if time is already up.
    if (tournament.ends_at !== null && now >= tournament.ends_at && !hasStartedGame(tournament.id)) completeTournament(tournament.id);
    return false;
  }

  // Round robin by post: every game exists from the start, so it is over when none are left.
  if (tournament.format === "round_robin" && tournament.mode === "correspondence") {
    if (!hasStartedGame(tournament.id)) completeTournament(tournament.id);
    return false;
  }

  if (pairing.round !== tournament.current_round) return false;
  if (hasStartedGame(tournament.id, pairing.round)) return false;
  return startNextRound(tournament, pairing.round);
}

export function advanceTournamentSafely(gameId: string, noShowId: number | null): void {
  const mark = pendingUserEvents.length;
  try {
    getDb().transaction(() => advanceTournamentAfterGame(gameId, noShowId))();
  } catch (err) {
    pendingUserEvents.length = mark;
    log.error({ err, gameId }, "could not advance tournament after game");
  }
}

/** Gets tournaments moving again when a round finished but nothing created the next one. */
export function repairStalledTournaments(): string[] {
  const db = getDb();
  const stalled = db.prepare(`
    SELECT t.id FROM tournaments t
    WHERE t.status = 'running' AND t.format <> 'arena'
      AND (t.mode = 'live' OR t.format IN ('swiss', 'knockout'))
      AND NOT EXISTS (
        SELECT 1 FROM tournament_pairings p JOIN games g ON g.id = p.game_id
        WHERE p.tournament_id = t.id AND g.status = 'started'
      )
  `).all() as { id: string }[];
  const repaired: string[] = [];
  for (const { id } of stalled) {
    try {
      db.transaction(() => {
        const tournament = loadTournament(id);
        if (tournament && repairRound(tournament)) repaired.push(id);
      })();
    } catch (err) {
      pendingUserEvents.length = 0;
      log.error({ err, tournamentId: id }, "could not repair stalled tournament");
    }
  }
  flushTournamentEvents();
  return repaired;
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

// ---------------------------------------------------------------- reading

interface PairingDetail {
  round: number; board: number; match: number | null; leg: number;
  whiteId: number; blackId: number | null; isBye: number; forfeitBy: number | null; voided: number;
  gameId: string | null; status: string | null; result: string | null; termination: string | null; endedAt: number | null;
}

const ARENA_GAME_LIST_LIMIT = 60;

export function getTournament(tournamentId: string, viewerId: number) {
  const db = getDb();
  const tournament = db.prepare(`SELECT t.*, u.username AS organizer FROM tournaments t JOIN users u ON u.id = t.created_by WHERE t.id = ?`)
    .get(tournamentId) as (TournamentRow & { organizer: string; name: string; description: string | null; max_players: number; created_at: number }) | undefined;
  if (!tournament) return undefined;

  const participants = loadParticipants(tournamentId);
  const nameOf = new Map(participants.map((p) => [p.id, p.username]));
  const seedOf = new Map(participants.map((p) => [p.id, p.seed]));
  const name = (id: number | null) => (id === null ? null : nameOf.get(id) ?? "?");

  const rows = db.prepare(`
    SELECT p.round_number AS round, p.board_number AS board, p.match_number AS match, p.leg,
           p.white_id AS whiteId, p.black_id AS blackId, p.is_bye AS isBye, p.forfeit_by AS forfeitBy, p.voided,
           p.game_id AS gameId, g.status, g.result, g.termination, g.ended_at AS endedAt
    FROM tournament_pairings p LEFT JOIN games g ON g.id = p.game_id
    WHERE p.tournament_id = ? ORDER BY p.round_number, p.board_number
  `).all(tournamentId) as PairingDetail[];

  const toGame = (row: PairingDetail) => ({
    round: row.round, board: row.board, match: row.match, leg: row.leg,
    id: row.gameId!, status: row.status!, result: row.result, termination: row.termination, endedAt: row.endedAt,
    whiteId: row.whiteId, whiteName: name(row.whiteId)!, blackId: row.blackId!, blackName: name(row.blackId)!,
    forfeit: row.forfeitBy !== null,
  });
  let games = rows.filter((row) => row.gameId !== null).map(toGame);
  if (tournament.format === "arena") games = games.reverse().slice(0, ARENA_GAME_LIST_LIMIT); // newest first

  const skipped = rows.filter((row) => row.gameId === null && !row.isBye && (row.forfeitBy !== null || row.voided)).map((row) => ({
    round: row.round, whiteId: row.whiteId, whiteName: name(row.whiteId)!, blackId: row.blackId!, blackName: name(row.blackId)!,
    forfeitBy: row.forfeitBy, voided: Boolean(row.voided),
    result: row.voided ? null : row.forfeitBy === row.whiteId ? "0-1" : "1-0",
  }));
  const byes = rows.filter((row) => row.isBye).map((row) => ({ round: row.round, playerId: row.whiteId, name: name(row.whiteId)! }));

  const standingRows: (StandingRow & { username: string })[] = [];
  let bracket: ReturnType<typeof buildBracket> | undefined;
  if (tournament.format === "knockout") {
    bracket = buildBracket(rows, seedOf, name);
    const placed = knockoutStandings(participants, bracket);
    standingRows.push(...placed.map((row) => ({ ...row, username: nameOf.get(row.id)! })));
  } else {
    const table = computeStandings(tournament.format, participants, loadScoredGames(tournamentId), {
      streakBonus: tournament.streak_bonus === 1,
    });
    standingRows.push(...table.map((row) => ({ ...row, username: nameOf.get(row.id)! })));
  }

  const me = participants.find((p) => p.id === viewerId);
  return {
    tournament: {
      id: tournament.id, name: tournament.name, description: tournament.description,
      status: tournament.status, format: tournament.format, rated: Boolean(tournament.rated),
      mode: tournament.mode, initialMs: tournament.initial_ms, incrementMs: tournament.increment_ms,
      daysPerMove: tournament.days_per_move, variant: tournament.variant, maxPlayers: tournament.max_players,
      rounds: tournament.rounds, currentRound: tournament.current_round,
      durationMs: tournament.duration_ms, streakBonus: tournament.streak_bonus === 1,
      startsAt: tournament.starts_at, endsAt: tournament.ends_at,
      organizer: tournament.organizer, createdAt: tournament.created_at, startedAt: tournament.started_at,
      joined: me !== undefined, isOrganizer: tournament.created_by === viewerId, paused: me?.paused ?? false,
      canJoinLate: tournament.format === "arena" && tournament.status === "running" && (tournament.ends_at ?? 0) > Date.now(),
    },
    participants: participants.map((p) => ({ id: p.id, username: p.username, seed: p.seed, paused: p.paused })),
    standings: standingRows,
    games,
    skipped,
    byes,
    bracket,
  };
}

function buildBracket(rows: PairingDetail[], seedOf: Map<number, number>, name: (id: number | null) => string | null) {
  const seed = (id: number) => seedOf.get(id) ?? Number.MAX_SAFE_INTEGER;
  const rounds = new Map<number, Map<number, PairingDetail[]>>();
  for (const row of rows) {
    if (row.match === null) continue;
    const matches = rounds.get(row.round) ?? new Map<number, PairingDetail[]>();
    matches.set(row.match, [...(matches.get(row.match) ?? []), row]);
    rounds.set(row.round, matches);
  }
  return [...rounds.entries()].sort(([a], [b]) => a - b).map(([round, matches]) => ({
    round,
    matches: [...matches.entries()].sort(([a], [b]) => a - b).map(([match, legs]) => {
      const first = legs[0]!;
      if (first.isBye) {
        return { match, bye: true, highId: first.whiteId, highName: name(first.whiteId)!, lowId: null, lowName: null, winnerId: first.whiteId, bySeed: false, legs: [] };
      }
      const [a, b] = [first.whiteId, first.blackId!];
      const [highId, lowId] = seed(a) <= seed(b) ? [a, b] : [b, a];
      const outcome = matchOutcome(highId, lowId, legs.map((leg): Leg => ({
        whiteId: leg.whiteId, blackId: leg.blackId!, forfeitBy: leg.forfeitBy,
        ...(leg.status === "finished" && leg.result ? { result: leg.result as Leg["result"] } : {}),
      })), seed);
      return {
        match, bye: false, highId, highName: name(highId)!, lowId, lowName: name(lowId)!,
        winnerId: outcome.status === "decided" ? outcome.winnerId : null,
        bySeed: outcome.status === "decided" && outcome.bySeed,
        legs: legs.map((leg) => ({
          gameId: leg.gameId, leg: leg.leg, status: leg.status, result: leg.result, forfeit: leg.forfeitBy !== null,
          whiteId: leg.whiteId,
        })),
      };
    }),
  }));
}

/** Knockout placing: champion first, then by how late a player went out, then seed. Points = matches won. */
function knockoutStandings(
  participants: { id: number; seed: number }[],
  bracket: ReturnType<typeof buildBracket>,
): StandingRow[] {
  const rows = new Map<number, StandingRow>(participants.map((p) => [p.id, {
    id: p.id, seed: p.seed, points: 0, wins: 0, draws: 0, losses: 0, gamesPlayed: 0,
    buchholz: 0, sonnebornBerger: 0, streak: 0, onFire: false, eliminatedIn: null,
  }]));
  for (const { round, matches } of bracket) {
    for (const match of matches) {
      if (match.winnerId === null) continue;
      const winner = rows.get(match.winnerId);
      if (winner) { winner.wins += 1; winner.points += 1; winner.gamesPlayed += 1; }
      if (match.lowId !== null) {
        const loserId = match.winnerId === match.highId ? match.lowId : match.highId;
        const loser = rows.get(loserId);
        if (loser) { loser.losses += 1; loser.gamesPlayed += 1; loser.eliminatedIn = round; }
      }
    }
  }
  return [...rows.values()].sort((a, b) => {
    const left = a.eliminatedIn ?? Number.MAX_SAFE_INTEGER;
    const right = b.eliminatedIn ?? Number.MAX_SAFE_INTEGER;
    return right - left || b.wins - a.wins || a.seed - b.seed;
  });
}

