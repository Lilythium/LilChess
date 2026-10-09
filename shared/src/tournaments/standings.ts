import type { MatchResult, ScoredGame, StandingPlayer, StandingRow, TournamentFormat } from "./types.js";

export const ARENA_WIN = 2;
export const ARENA_DRAW = 1;
/** Wins in a row needed before the next game scores double. */
export const ARENA_STREAK_TRIGGER = 2;

export type Outcome = "win" | "draw" | "loss";

export function outcomeFor(result: MatchResult, asWhite: boolean): Outcome {
  if (result === "1/2-1/2") return "draw";
  return (result === "1-0") === asWhite ? "win" : "loss";
}

/** Arena points for one game. `streak` is the player's consecutive wins *before* this game. */
export function arenaScore(outcome: Outcome, streak: number, streakBonus: boolean): number {
  const base = outcome === "win" ? ARENA_WIN : outcome === "draw" ? ARENA_DRAW : 0;
  return streakBonus && streak >= ARENA_STREAK_TRIGGER ? base * 2 : base;
}

const emptyRow = (player: StandingPlayer): StandingRow => ({
  id: player.id, seed: player.seed, points: 0, wins: 0, draws: 0, losses: 0, gamesPlayed: 0,
  buchholz: 0, sonnebornBerger: 0, streak: 0, onFire: false, eliminatedIn: null,
});

export interface StandingsOptions {
  streakBonus?: boolean;
}

/**
 * Scores every player and sorts the table.
 *  - round robin / swiss / knockout: 1 point per win, ½ per draw, a bye counts as a win.
 *  - arena: 2 / 1 / 0, doubled after two wins in a row (when `streakBonus` is on).
 * Tiebreaks: round robin → Sonneborn-Berger then wins; swiss → Buchholz then Sonneborn-Berger;
 * arena → wins; always finishing on seed so the order is deterministic.
 */
export function computeStandings(
  format: TournamentFormat,
  players: StandingPlayer[],
  games: ScoredGame[],
  options: StandingsOptions = {},
): StandingRow[] {
  const rows = new Map(players.map((player) => [player.id, emptyRow(player)]));
  const ordered = games
    .map((game, index) => ({ game, key: game.at ?? index }))
    .sort((a, b) => a.key - b.key)
    .map(({ game }) => game);

  const opponentsOf = new Map<number, { id: number; outcome: Outcome }[]>();
  const record = (id: number, opponent: number | null, outcome: Outcome, points: number) => {
    const row = rows.get(id);
    if (!row) return;
    row.points += points;
    row.gamesPlayed += 1;
    if (outcome === "win") row.wins += 1;
    else if (outcome === "draw") row.draws += 1;
    else row.losses += 1;
    if (opponent !== null) opponentsOf.set(id, [...(opponentsOf.get(id) ?? []), { id: opponent, outcome }]);
  };

  for (const game of ordered) {
    if (game.bye) {
      record(game.whiteId, null, "win", 1);
      continue;
    }
    if (game.result === null || game.blackId === null) continue;
    for (const [id, opponent, asWhite] of [
      [game.whiteId, game.blackId, true],
      [game.blackId, game.whiteId, false],
    ] as const) {
      const outcome = outcomeFor(game.result, asWhite);
      if (format === "arena") {
        const row = rows.get(id);
        const streak = row?.streak ?? 0;
        record(id, opponent, outcome, arenaScore(outcome, streak, options.streakBonus ?? true));
        if (row) row.streak = outcome === "win" ? streak + 1 : 0;
      } else {
        record(id, opponent, outcome, outcome === "win" ? 1 : outcome === "draw" ? 0.5 : 0);
      }
    }
  }

  for (const row of rows.values()) {
    for (const { id: opponent, outcome } of opponentsOf.get(row.id) ?? []) {
      const opponentPoints = rows.get(opponent)?.points ?? 0;
      row.buchholz += opponentPoints;
      if (outcome === "win") row.sonnebornBerger += opponentPoints;
      else if (outcome === "draw") row.sonnebornBerger += opponentPoints / 2;
    }
    row.onFire = options.streakBonus !== false && row.streak >= ARENA_STREAK_TRIGGER;
  }

  const tiebreaks: ((row: StandingRow) => number)[] =
    format === "swiss" ? [(r) => r.buchholz, (r) => r.sonnebornBerger, (r) => r.wins]
    : format === "round_robin" ? [(r) => r.sonnebornBerger, (r) => r.wins]
    : [(r) => r.wins];

  return [...rows.values()].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    for (const tiebreak of tiebreaks) {
      const diff = tiebreak(b) - tiebreak(a);
      if (diff !== 0) return diff;
    }
    return a.seed - b.seed;
  });
}
