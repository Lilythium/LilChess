import type { GameState, Variant } from "@lilchess/shared";

export interface RatingBadge { rating: number; provisional: boolean }
export interface Players {
  whiteId: number; whiteName: string; blackId: number; blackName: string;
  whiteRating?: RatingBadge | null; blackRating?: RatingBadge | null;
}
export interface H2H { wins: number; draws: number; losses: number }
export interface SimulInfo { id: string; name: string; hostId: number; hostName: string }

export interface SimulSummary extends SimulInfo {
  isPublic: boolean;
}

export interface SimulLists {
  active: SimulSummary[];
  finished: SimulSummary[];
  open: SimulSummary[];
}

export type SimulInviteStatus = "pending" | "accepted" | "declined" | string;

export interface SimulDetail {
  simul: SimulInfo & {
    isPublic: boolean;
    inviteCode: string | null;
  };
  viewer: {
    isHost: boolean;
    invite: SimulInviteStatus | null;
    gameId: string | null;
    canJoin: boolean;
  };
}

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
  days_per_move: number | null; color_pref: string | null; rated: number;
  is_link: number;
}
export interface Challenges { mine: ChallengeRow[]; forMe: ChallengeRow[]; open: ChallengeRow[] }

export interface AnalysisResponse {
  ok: true;
  variant: Variant;
  initialFen: string;
  moves: string[]; // UCI, in the order played
  status: string;
  result: string | null;
  termination: string | null;
  white: string;
  black: string;
}

// Games imported from PGN files. They name their players as plain text and belong to one user.
export interface ImportedGameRow {
  id: string;
  white: string;
  black: string;
  whiteElo: number | null;
  blackElo: number | null;
  event: string | null;
  site: string | null;
  date: string | null; // PGN style, e.g. "2026.10.10"
  variant: Variant;
  timeControl: string | null;
  result: "1-0" | "0-1" | "1/2-1/2" | "*";
  termination: string | null;
  fen: string;
  lastMove: string | null;
  plies: number;
  importedAt: number;
}
export interface ImportedList { ok: true; total: number; games: ImportedGameRow[] }
export interface ImportFailure { index: number; label: string; message: string }
export interface ImportSummary {
  ok: true;
  imported: string[];
  duplicates: number;
  overLimit: number;
  failures: ImportFailure[];
}