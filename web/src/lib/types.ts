import type { GameState } from "@lilchess/shared";

export interface RatingBadge { rating: number; provisional: boolean }
export interface Players {
  whiteId: number; whiteName: string; blackId: number; blackName: string;
  whiteRating?: RatingBadge | null; blackRating?: RatingBadge | null;
}
export interface H2H { wins: number; draws: number; losses: number }
export interface SimulInfo { id: string; name: string; hostId: number; hostName: string }
export interface GameResponse {
  ok: true; game: GameState; sans: string[]; players: Players; h2h: H2H | null; serverNow: number;
  simul: SimulInfo | null;
}

export interface GameRow {
  id: string; white_id: number; black_id: number; white_name: string; black_name: string;
  mode: "live" | "correspondence"; initial_ms: number | null; increment_ms: number | null;
  days_per_move: number | null; status: string; result: string | null; termination: string | null;
  ply: number; deadline_at: number; ended_at: number | null;
  fen: string; last_move: string | null; variant: string; simul_id: string | null; simul_host_id: number | null;
}

export interface MyGames { myTurn: GameRow[]; theirTurn: GameRow[]; finished: GameRow[] }

export type LiveGameRow = Pick<
  GameRow,
  | "id" | "white_id" | "black_id" | "white_name" | "black_name"
  | "mode" | "initial_ms" | "increment_ms" | "days_per_move"
  | "ply" | "deadline_at" | "fen" | "last_move" | "variant"
  | "simul_id" | "simul_host_id"
>;

export interface ChallengeRow {
  id: string; from_user: number; from_name: string; to_user: number | null;
  mode: "live" | "correspondence"; initial_ms: number | null; increment_ms: number | null;
  days_per_move: number | null; color_pref: string | null;
  is_link: number;
}
export interface Challenges { mine: ChallengeRow[]; forMe: ChallengeRow[]; open: ChallengeRow[] }