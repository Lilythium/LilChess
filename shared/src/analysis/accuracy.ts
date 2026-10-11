import type { Color } from "../core/types.js";
import type { MoveVerdict } from "./classify.js";

// Per-move curve: 0 win-chance points lost = ~100%, falling off as the loss grows.
// These are the constants lichess publishes for its accuracy metric.
const A = 103.1668100711649;
const B = 0.04354415386753951;
const C = 3.166924740191411;

/** Accuracy of one move (0..100) from the win-chance points it gave up. */
export function moveAccuracy(loss: number): number {
  const raw = A * Math.exp(-B * Math.max(0, loss)) - C;
  return Math.max(0, Math.min(100, raw));
}

/**
 * Game accuracy for one side: the mean of the arithmetic and harmonic means of its
 * move accuracies. The harmonic part punishes a few terrible moves harder than a plain
 * average would. This is a simplified blend (lichess also weights moves by how
 * volatile the position was), so expect numbers in the same ballpark, not identical.
 * Returns null when the side has no evaluated moves.
 */
export function averageAccuracy(accuracies: number[]): number | null {
  if (accuracies.length === 0) return null;
  const arithmetic = accuracies.reduce((sum, a) => sum + a, 0) / accuracies.length;
  const harmonic = accuracies.length / accuracies.reduce((sum, a) => sum + 1 / Math.max(a, 1), 0);
  return (arithmetic + harmonic) / 2;
}

/** Accuracy per side from classifyGame's output (index i is ply i+1, so even i is White). */
export function gameAccuracy(verdicts: (MoveVerdict | undefined)[]): Record<Color, number | null> {
  const per: Record<Color, number[]> = { white: [], black: [] };
  verdicts.forEach((v, i) => {
    if (!v) return;
    // Playing the engine's own move is never penalised for evaluation noise between searches.
    per[i % 2 === 0 ? "white" : "black"].push(moveAccuracy(v.cls === "best" ? 0 : v.loss));
  });
  return { white: averageAccuracy(per.white), black: averageAccuracy(per.black) };
}
