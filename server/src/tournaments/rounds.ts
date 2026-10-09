import {
  computeStandings, defaultSwissRounds, firstRound, matchOutcome, nextRound, swissRound,
  type Leg, type RoundRobinPairing, type SwissPlayer,
} from "@lilchess/shared";
import { getDb } from "../db/connection.js";
import { logger } from "../logger.js";
import {
  completeTournament, hasStartedGame, insertBye, insertPairingWithGame, loadParticipants, loadScoredGames,
  nextBoardNumber, startPairingGame, type TournamentRow,
} from "./shared.js";

const log = logger.child({ mod: "tournament-rounds" });

// ---------------------------------------------------------------- round robin

/** Round robin pairings are all inserted at the start; a round just creates the games for its rows. */
function startRoundRobinRound(tournament: TournamentRow, round: number): number {
  const db = getDb();
  db.prepare(`UPDATE tournaments SET current_round = ? WHERE id = ?`).run(round, tournament.id);
  const paused = new Set(loadParticipants(tournament.id).filter((p) => p.paused).map((p) => p.id));
  const pairings = db.prepare(`
    SELECT round_number AS round, board_number AS board, white_id AS whiteId, black_id AS blackId
    FROM tournament_pairings
    WHERE tournament_id = ? AND round_number = ? AND game_id IS NULL AND forfeit_by IS NULL AND voided = 0
    ORDER BY board_number
  `).all(tournament.id, round) as RoundRobinPairing[];

  let created = 0;
  for (const pairing of pairings) {
    const whitePaused = paused.has(pairing.whiteId);
    const blackPaused = paused.has(pairing.blackId);
    if (!whitePaused && !blackPaused) {
      const gameId = startPairingGame(tournament, pairing.whiteId, pairing.blackId, pairing.round, Date.now());
      db.prepare(`
        UPDATE tournament_pairings SET game_id = ?
        WHERE tournament_id = ? AND round_number = ? AND board_number = ? AND game_id IS NULL
      `).run(gameId, tournament.id, pairing.round, pairing.board);
      created++;
      continue;
    }
    db.prepare(`
      UPDATE tournament_pairings SET forfeit_by = ?, voided = ?
      WHERE tournament_id = ? AND round_number = ? AND board_number = ?
    `).run(
      whitePaused && blackPaused ? null : whitePaused ? pairing.whiteId : pairing.blackId,
      whitePaused && blackPaused ? 1 : 0,
      tournament.id, pairing.round, pairing.board,
    );
  }
  return created;
}

// ---------------------------------------------------------------- swiss

/** Pairs one swiss round from everybody who is not paused. Returns how many games were created. */
export function startSwissRound(tournament: TournamentRow, round: number): number {
  const db = getDb();
  db.prepare(`UPDATE tournaments SET current_round = ? WHERE id = ?`).run(round, tournament.id);

  const participants = loadParticipants(tournament.id);
  const scored = loadScoredGames(tournament.id);
  const standings = new Map(computeStandings("swiss", participants, scored).map((row) => [row.id, row]));

  const pool: SwissPlayer[] = participants.filter((p) => !p.paused).map((p) => {
    const mine = scored.filter((g) => g.whiteId === p.id || g.blackId === p.id);
    return {
      id: p.id,
      seed: p.seed,
      points: standings.get(p.id)?.points ?? 0,
      opponents: mine.flatMap((g) => (g.bye ? [] : [g.whiteId === p.id ? g.blackId! : g.whiteId])),
      colors: mine.flatMap((g) => (g.bye ? [] : [g.whiteId === p.id ? "w" as const : "b" as const])),
      hadBye: mine.some((g) => g.bye),
    };
  });

  const result = swissRound(pool);
  if (result.rematches > 0) log.warn({ tournamentId: tournament.id, round, rematches: result.rematches }, "swiss round needed a rematch");

  result.pairings.forEach((pairing, index) => {
    insertPairingWithGame(tournament, { round, board: index + 1, ...pairing }, Date.now());
  });
  if (result.byeId !== null) insertBye(tournament.id, round, result.pairings.length + 1, result.byeId);
  return result.pairings.length;
}

export function swissTotalRounds(requested: number | null, playerCount: number): number {
  return Math.min(requested ?? defaultSwissRounds(playerCount), Math.max(1, playerCount - 1));
}

// ---------------------------------------------------------------- knockout

interface KnockoutRow {
  round: number; board: number; match: number; leg: number;
  whiteId: number; blackId: number | null; isBye: number; forfeitBy: number | null;
  status: string | null; result: Leg["result"] | null;
}

function knockoutRows(tournamentId: string, round: number): KnockoutRow[] {
  return getDb().prepare(`
    SELECT p.round_number AS round, p.board_number AS board, p.match_number AS match, p.leg,
           p.white_id AS whiteId, p.black_id AS blackId, p.is_bye AS isBye, p.forfeit_by AS forfeitBy,
           g.status, g.result
    FROM tournament_pairings p LEFT JOIN games g ON g.id = p.game_id
    WHERE p.tournament_id = ? AND p.round_number = ? ORDER BY p.match_number, p.leg
  `).all(tournamentId, round) as KnockoutRow[];
}

/** Round one of a knockout: seeds meet in the standard bracket, top seeds get byes. */
export function startKnockoutFirstRound(tournament: TournamentRow, idsBySeed: number[]): number {
  let created = 0;
  let board = 0;
  for (const match of firstRound(idsBySeed)) {
    if (match.lowId === null) {
      insertBye(tournament.id, 1, ++board, match.highId, match.match);
    } else {
      insertPairingWithGame(tournament, { round: 1, board: ++board, whiteId: match.highId, blackId: match.lowId, match: match.match }, Date.now());
      created++;
    }
  }
  return created;
}

/**
 * Called when the current knockout round has no running games. Replays drawn matches (colours swapped),
 * and once every match is decided either crowns the winner or pairs the next round.
 */
export function startNextKnockoutStep(tournament: TournamentRow, round: number): boolean {
  const db = getDb();
  const seeds = new Map(loadParticipants(tournament.id).map((p) => [p.id, p.seed]));
  const seedOf = (id: number) => seeds.get(id) ?? Number.MAX_SAFE_INTEGER;

  const byMatch = new Map<number, KnockoutRow[]>();
  for (const row of knockoutRows(tournament.id, round)) byMatch.set(row.match, [...(byMatch.get(row.match) ?? []), row]);

  const winners: number[] = [];
  let created = 0;
  for (const [match, rows] of [...byMatch.entries()].sort(([a], [b]) => a - b)) {
    if (rows[0]!.isBye) { winners.push(rows[0]!.whiteId); continue; }
    const ids = [rows[0]!.whiteId, rows[0]!.blackId!];
    const [highId, lowId] = seedOf(ids[0]!) <= seedOf(ids[1]!) ? ids as [number, number] : [ids[1]!, ids[0]!] as [number, number];
    const legs: Leg[] = rows.map((row) => ({
      whiteId: row.whiteId, blackId: row.blackId!, forfeitBy: row.forfeitBy,
      ...(row.status === "finished" && row.result ? { result: row.result } : {}),
    }));
    let outcome = matchOutcome(highId, lowId, legs, seedOf);
    if (outcome.status === "pending") {
      // Nothing is running here, so a missing result means the game was voided. Don't stall the bracket.
      log.error({ tournamentId: tournament.id, round, match }, "knockout match has no result and no running game; higher seed advances");
      outcome = { status: "decided", winnerId: highId, loserId: lowId, bySeed: true };
    }
    if (outcome.status === "tiebreak") {
      insertPairingWithGame(tournament, {
        round, board: nextBoardNumber(tournament.id, round), whiteId: outcome.nextWhiteId, blackId: outcome.nextBlackId,
        match, leg: rows.length + 1,
      }, Date.now());
      created++;
    } else if (outcome.status === "decided") {
      winners.push(outcome.winnerId);
    }
  }
  if (created > 0) return true;

  if (round >= (tournament.rounds ?? round)) {
    completeTournament(tournament.id);
    return false;
  }
  db.prepare(`UPDATE tournaments SET current_round = ? WHERE id = ?`).run(round + 1, tournament.id);
  let board = 0;
  for (const match of nextRound(winners, seedOf)) {
    insertPairingWithGame(tournament, {
      round: round + 1, board: ++board, whiteId: match.highId, blackId: match.lowId!, match: match.match,
    }, Date.now());
  }
  return true;
}

// ---------------------------------------------------------------- dispatcher

/**
 * The round after `afterRound` is needed: round robin creates its games, swiss pairs a new round, knockout
 * resolves the finished round. Returns true while the tournament continues, false once it is completed.
 */
export function startNextRound(tournament: TournamentRow, afterRound: number): boolean {
  const db = getDb();
  if (tournament.format === "knockout") return startNextKnockoutStep(tournament, afterRound);

  const total = tournament.rounds ?? (db.prepare(`
    SELECT MAX(round_number) AS total FROM tournament_pairings WHERE tournament_id = ?
  `).get(tournament.id) as { total: number | null }).total ?? afterRound;

  let round = afterRound;
  for (;;) {
    if (tournament.format === "round_robin") {
      const next = db.prepare(`
        SELECT MIN(round_number) AS round FROM tournament_pairings WHERE tournament_id = ? AND round_number > ?
      `).get(tournament.id, round) as { round: number | null };
      if (next.round === null) { completeTournament(tournament.id); return false; }
      round = next.round;
      if (startRoundRobinRound(tournament, round) > 0) return true;
    } else {
      if (round >= total) { completeTournament(tournament.id); return false; }
      round += 1;
      if (startSwissRound(tournament, round) > 0) return true;
    }
  }
}

/** Used when a running tournament has no live game and nothing moved it on (crash, bug, restart). */
export function repairRound(tournament: TournamentRow): boolean {
  const hasRows = (round: number) => getDb().prepare(
    `SELECT 1 FROM tournament_pairings WHERE tournament_id = ? AND round_number = ? LIMIT 1`,
  ).get(tournament.id, round) !== undefined;

  if (hasStartedGame(tournament.id, tournament.current_round)) return true;
  switch (tournament.format) {
    case "round_robin": return startNextRound(tournament, tournament.current_round - 1);
    case "swiss": return startNextRound(tournament, hasRows(tournament.current_round) ? tournament.current_round : tournament.current_round - 1);
    case "knockout": return startNextRound(tournament, tournament.current_round);
    default: return true;
  }
}
