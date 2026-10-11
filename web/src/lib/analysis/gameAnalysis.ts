import { terminalScore, type PositionEval } from "@lilchess/shared";
import type { SearchEngine } from "./engine";

export interface AnalyseGameOptions {
  chess960: boolean;
  depth: number;
  signal?: AbortSignal;
  /** Called after every position; `evals[i]` belongs to `fens[i]`. */
  onProgress?: (done: number, evals: (PositionEval | undefined)[]) => void;
}

/**
 * Evaluates every position of a game, one after another. Positions that need no
 * engine (checkmate, stalemate, bare kings) are scored directly. Stops early when
 * `signal` aborts or the engine is stopped, returning what it has so far.
 */
export async function analyseGame(
  engine: SearchEngine,
  fens: string[],
  options: AnalyseGameOptions,
): Promise<(PositionEval | undefined)[]> {
  const evals: (PositionEval | undefined)[] = new Array(fens.length).fill(undefined);
  await engine.newGame();

  for (let i = 0; i < fens.length; i++) {
    if (options.signal?.aborted) break;

    const fen = fens[i]!;
    const terminal = terminalScore(fen);
    if (terminal) {
      evals[i] = { score: terminal, best: null, depth: 0 };
    } else {
      const result = await engine.search({ fen, chess960: options.chess960, depth: options.depth, multipv: 1 });
      if (result.cancelled || options.signal?.aborted) break;
      const top = result.lines[0];
      if (top) evals[i] = { score: top.score, best: result.bestMove ?? top.pv[0] ?? null, depth: top.depth };
    }
    options.onProgress?.(i + 1, evals);
  }
  return evals;
}
