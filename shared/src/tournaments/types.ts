export const TOURNAMENT_FORMATS = ["round_robin", "swiss", "knockout", "arena", "simul2"] as const;
export type TournamentFormat = (typeof TOURNAMENT_FORMATS)[number];

export type MatchResult = "1-0" | "0-1" | "1/2-1/2";

/** One decided game (or bye) as the standings code sees it. `blackId` is null for a bye. */
export interface ScoredGame {
  round: number;
  whiteId: number;
  blackId: number | null;
  result: MatchResult | null; // null: voided, scores nothing
  bye?: boolean;
  /** Chronological order, used by arena streaks. Defaults to array order. */
  at?: number;
}

export interface StandingPlayer {
  id: number;
  seed: number; // 1 = first to join
  /** Rating when the tournament started. Only Simul2 uses it (performance rating tiebreak). */
  rating?: number;
}

export interface StandingRow {
  id: number;
  seed: number;
  points: number;
  wins: number;
  draws: number;
  losses: number;
  gamesPlayed: number;
  buchholz: number;
  sonnebornBerger: number;
  /** Arena only: current consecutive wins, and whether the next game is worth double. */
  streak: number;
  onFire: boolean;
  /** Knockout only: round the player lost in, null while still alive or for the champion. */
  eliminatedIn: number | null;
  /** Simul2 only: performance rating (average opponent rating + the rating gap that score implies). */
  performance?: number;
}
