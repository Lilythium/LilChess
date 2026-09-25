export type Color = "white" | "black";

export function opponent(color: Color): Color {
  return color === "white" ? "black" : "white";
}

export type Variant = "standard"; // add more later

export type ClockMode = "live" | "correspondence";

export interface ClockConfig {
  mode: ClockMode;
  initialMs?: number; // required for "live"
  incrementMs?: number; // optional for "live", default 0
  daysPerMove?: number; // required for "correspondence"
}

export type GameStatus = "started" | "finished" | "aborted";

export type Termination =
  | "checkmate"
  | "stalemate"
  | "insufficient_material"
  | "fifty_move"
  | "repetition"
  | "resignation"
  | "agreement"
  | "timeout"
  | "abort";

export type GameResult = "1-0" | "0-1" | "1/2-1/2";

export interface GameState {
  variant: Variant;
  initialFen: string;
  moves: string[]; // UCI strings, in the order played
  ply: number; // == moves.length, kept explicit to mirror the DB schema
  turn: Color;
  clock: ClockConfig;
  whiteMs: number; // unused (0) for correspondence
  blackMs: number;
  turnStartedAt: number; // epoch ms
  deadlineAt: number; // epoch ms — the side to move loses if now passes this
  status: GameStatus;
  result?: GameResult;
  termination?: Termination;
  drawOfferedBy?: Color;
}

export const START_FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export type ActionResult =
  | { ok: true; state: GameState }
  | { ok: false; error: string };