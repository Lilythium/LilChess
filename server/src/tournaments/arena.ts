import { arenaPairings, computeStandings, type ArenaCandidate } from "@lilchess/shared";
import { getDb } from "../db/connection.js";
import { logger } from "../logger.js";
import { userSocketCount } from "../ws/hub.js";
import {
  completeTournament, flushTournamentEvents, hasStartedGame, insertPairingWithGame, loadParticipants,
  loadScoredGames, nextBoardNumber, pendingUserEvents, type TournamentRow,
} from "./shared.js";

const log = logger.child({ mod: "arena" });

export const ARENA_ROUND = 1; // arena games all live in one "round"
export const ARENA_TICK_MS = 2_000;

/** Stop pairing once less than one side's clock is left, so games can mostly finish before the end. */
export const arenaStopPairingAt = (tournament: TournamentRow): number =>
  (tournament.ends_at ?? Infinity) - (tournament.initial_ms ?? 0);

export type Presence = (userId: number) => boolean;
const defaultPresence: Presence = (userId) => userSocketCount(userId) > 0;

function runningArenas(): TournamentRow[] {
  return getDb().prepare(`SELECT * FROM tournaments WHERE status = 'running' AND format = 'arena'`).all() as TournamentRow[];
}

export function hasRunningArena(): boolean {
  return getDb().prepare(`SELECT 1 FROM tournaments WHERE status = 'running' AND format = 'arena' LIMIT 1`).get() !== undefined;
}

export function getNextArenaEnd(): number | undefined {
  const row = getDb().prepare(`SELECT MIN(ends_at) AS endsAt FROM tournaments WHERE status = 'running' AND format = 'arena'`)
    .get() as { endsAt: number | null };
  return row.endsAt ?? undefined;
}

/** Arena players who are free right now: joined, not paused, online and not in a game. */
function freePlayers(tournament: TournamentRow, now: number, isOnline: Presence): ArenaCandidate[] {
  const db = getDb();
  const standings = new Map(computeStandings("arena", loadParticipants(tournament.id), loadScoredGames(tournament.id), {
    streakBonus: tournament.streak_bonus === 1,
  }).map((row) => [row.id, row]));

  const busy = new Set((db.prepare(`
    SELECT g.white_id AS w, g.black_id AS b FROM tournament_pairings p JOIN games g ON g.id = p.game_id
    WHERE p.tournament_id = ? AND g.status = 'started'
  `).all(tournament.id) as { w: number; b: number }[]).flatMap((g) => [g.w, g.b]));

  const history = db.prepare(`
    SELECT p.white_id AS w, p.black_id AS b, COALESCE(g.ended_at, g.created_at) AS at
    FROM tournament_pairings p JOIN games g ON g.id = p.game_id
    WHERE p.tournament_id = ? ORDER BY p.board_number
  `).all(tournament.id) as { w: number; b: number; at: number }[];

  const joinedAt = new Map((db.prepare(`SELECT user_id AS id, joined_at AS at FROM tournament_participants WHERE tournament_id = ?`)
    .all(tournament.id) as { id: number; at: number }[]).map((row) => [row.id, row.at]));

  return loadParticipants(tournament.id)
    .filter((p) => !p.paused && !busy.has(p.id) && isOnline(p.id))
    .map((p) => {
      const mine = history.filter((g) => g.w === p.id || g.b === p.id);
      const last = mine.at(-1);
      return {
        id: p.id,
        points: standings.get(p.id)?.points ?? 0,
        lastOpponentId: last ? (last.w === p.id ? last.b : last.w) : null,
        idleSince: last?.at ?? Math.max(joinedAt.get(p.id) ?? now, tournament.started_at ?? 0),
        whites: mine.filter((g) => g.w === p.id).length,
        blacks: mine.filter((g) => g.b === p.id).length,
      };
    });
}

/**
 * Pairs everybody who is free in every running arena. Cheap enough to run every couple of seconds from the
 * scheduler; returns the ids of arenas where games were created.
 */
export function runArenaPairing(now = Date.now(), isOnline: Presence = defaultPresence): string[] {
  const db = getDb();
  const paired: string[] = [];
  for (const tournament of runningArenas()) {
    if (now >= arenaStopPairingAt(tournament)) continue;
    try {
      const created = db.transaction(() => {
        const pairings = arenaPairings(freePlayers(tournament, now, isOnline), now);
        for (const pairing of pairings) {
          insertPairingWithGame(tournament, {
            round: ARENA_ROUND, board: nextBoardNumber(tournament.id, ARENA_ROUND), ...pairing,
          }, now);
        }
        return pairings.length;
      }).immediate();
      if (created > 0) paired.push(tournament.id);
    } catch (err) {
      pendingUserEvents.length = 0; // nothing from the failed pass was committed
      log.error({ err, tournamentId: tournament.id }, "arena pairing failed");
    }
  }
  flushTournamentEvents();
  return paired;
}

/** Marks arenas whose time is up (and whose last game is over) as completed. */
export function finishDueArenas(now = Date.now()): string[] {
  const finished: string[] = [];
  for (const tournament of runningArenas()) {
    if (tournament.ends_at !== null && now >= tournament.ends_at && !hasStartedGame(tournament.id)) {
      completeTournament(tournament.id);
      finished.push(tournament.id);
    }
  }
  return finished;
}
