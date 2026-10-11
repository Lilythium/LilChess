import type { Color } from "../core/types.js";
import { winPercent, type Score } from "./score.js";
import { sameMove } from "./pv.js";

export type MoveClass = "best" | "good" | "inaccuracy" | "mistake" | "blunder";

/** Win-chance points (0..100) a move may lose before it gets each label. Tune to taste. */
export const THRESHOLDS = { inaccuracy: 10, mistake: 20, blunder: 30 } as const;
const BEST_EPSILON = 0.5;

/** Engine verdict on one position. `score` is from White's point of view. */
export interface PositionEval {
  score: Score;
  best: string | null; // engine's top move (UCI), null for a finished game
  depth: number;
}

export interface MoveVerdict {
  cls: MoveClass;
  loss: number; // win-chance points the mover gave up, >= 0
}

function moverWin(score: Score, mover: Color): number {
  const white = winPercent(score);
  return mover === "white" ? white : 100 - white;
}

export function classifyMove(
  before: PositionEval,
  after: PositionEval,
  mover: Color,
  playedBest: boolean,
): MoveVerdict {
  const loss = Math.max(0, moverWin(before.score, mover) - moverWin(after.score, mover));
  let cls: MoveClass;
  if (playedBest || loss <= BEST_EPSILON) cls = "best";
  else if (loss >= THRESHOLDS.blunder) cls = "blunder";
  else if (loss >= THRESHOLDS.mistake) cls = "mistake";
  else if (loss >= THRESHOLDS.inaccuracy) cls = "inaccuracy";
  else cls = "good";
  return { cls, loss };
}

/**
 * evals[i] is the evaluation of fens[i] (fens[0] = start position). The verdict for
 * ply i (1-based) sits at index i-1 and is undefined until both positions it needs
 * have been evaluated.
 */
export function classifyGame(
  fens: string[],
  moves: string[],
  evals: (PositionEval | undefined)[],
): (MoveVerdict | undefined)[] {
  return moves.map((uci, i) => {
    const before = evals[i];
    const after = evals[i + 1];
    if (!before || !after) return undefined;
    const mover: Color = i % 2 === 0 ? "white" : "black";
    const fenBefore = fens[i];
    const playedBest = !!before.best && !!fenBefore && sameMove(fenBefore, uci, before.best);
    return classifyMove(before, after, mover, playedBest);
  });
}

export type VerdictCounts = Record<"inaccuracy" | "mistake" | "blunder", number>;

/** Inaccuracy / mistake / blunder counts per side, from classifyGame's output. */
export function summariseVerdicts(
  verdicts: (MoveVerdict | undefined)[],
): Record<Color, VerdictCounts> {
  const out: Record<Color, VerdictCounts> = {
    white: { inaccuracy: 0, mistake: 0, blunder: 0 },
    black: { inaccuracy: 0, mistake: 0, blunder: 0 },
  };
  verdicts.forEach((v, i) => {
    if (v && (v.cls === "inaccuracy" || v.cls === "mistake" || v.cls === "blunder")) {
      out[i % 2 === 0 ? "white" : "black"][v.cls]++;
    }
  });
  return out;
}
