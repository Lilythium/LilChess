import type { Color } from "../core/types.js";

/** Raw engine score: from the point of view of the side to move (what UCI reports). */
export type RawScore =
  | { kind: "cp"; cp: number }
  | { kind: "mate"; moves: number }; // > 0: side to move mates in N, < 0: gets mated in N

/** Everything the UI stores and displays is from White's point of view. */
export type Score =
  | { kind: "cp"; cp: number }
  | { kind: "mate"; moves: number } // > 0: White mates in N, < 0: Black mates in N
  | { kind: "checkmate"; winner: Color }; // the position itself is checkmate

export function toWhite(score: RawScore, turn: Color): Score {
  const sign = turn === "white" ? 1 : -1;
  return score.kind === "cp"
    ? { kind: "cp", cp: score.cp * sign }
    : { kind: "mate", moves: score.moves * sign };
}

const CP_CLAMP = 1000;
const WIN_K = 0.00368208; // logistic steepness (the constant lichess fits to real games)

/** White's winning chances, 0..100. Mate is 0 or 100; centipawns are clamped to ±1000. */
export function winPercent(score: Score): number {
  if (score.kind === "checkmate") return score.winner === "white" ? 100 : 0;
  if (score.kind === "mate") return score.moves > 0 ? 100 : 0;
  const cp = Math.max(-CP_CLAMP, Math.min(CP_CLAMP, score.cp));
  return 50 + 50 * (2 / (1 + Math.exp(-WIN_K * cp)) - 1);
}

/** "+0.35", "-1.20", "#3", "#-2", or the result for a checkmated position. */
export function formatScore(score: Score): string {
  if (score.kind === "checkmate") return score.winner === "white" ? "1-0" : "0-1";
  if (score.kind === "mate") return `#${score.moves}`;
  const pawns = (score.cp / 100).toFixed(2);
  return score.cp > 0 ? `+${pawns}` : pawns === "-0.00" ? "0.00" : pawns;
}
