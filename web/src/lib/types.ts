import type { GameState } from "@lilchess/shared";

export interface Players { whiteId: number; whiteName: string; blackId: number; blackName: string }
export interface GameResponse { ok: true; game: GameState; sans: string[]; players: Players; serverNow: number }

export interface GameRow {
  id: string; white_id: number; black_id: number; white_name: string; black_name: string;
  mode: "live" | "correspondence"; initial_ms: number | null; increment_ms: number | null;
  days_per_move: number | null; status: string; result: string | null; termination: string | null;
  ply: number; deadline_at: number; ended_at: number | null;
}
export interface MyGames { myTurn: GameRow[]; theirTurn: GameRow[]; finished: GameRow[] }

export interface ChallengeRow {
  id: string; from_user: number; from_name: string; to_user: number | null;
  mode: "live" | "correspondence"; initial_ms: number | null; increment_ms: number | null;
  days_per_move: number | null; color_pref: string | null;
}
export interface Challenges { mine: ChallengeRow[]; forMe: ChallengeRow[]; open: ChallengeRow[] }