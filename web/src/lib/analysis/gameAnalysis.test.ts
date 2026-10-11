import { describe, expect, it } from "vitest";
import { PositionTimeline, START_FEN, classifyGame } from "@lilchess/shared";
import { analyseGame } from "./gameAnalysis";
import type { SearchEngine, SearchRequest, SearchResult } from "./engine";

function fakeEngine(cpByFen: (fen: string) => number, bestByFen: (fen: string) => string | null = () => null) {
  const searched: string[] = [];
  let games = 0;
  const engine: SearchEngine = {
    async newGame() { games++; },
    async search(req: SearchRequest): Promise<SearchResult> {
      searched.push(req.fen);
      const cp = cpByFen(req.fen); // White's point of view
      const best = bestByFen(req.fen);
      return {
        cancelled: false,
        bestMove: best,
        lines: [{ multipv: 1, depth: req.depth, score: { kind: "cp", cp }, pv: best ? [best] : [] }],
      };
    },
  };
  return { engine, searched, games: () => games };
}

describe("analyseGame", () => {
  const tl = new PositionTimeline(START_FEN);
  tl.sync(["e2e4", "e7e5", "d1h5"]);

  it("evaluates every position in order and reports progress", async () => {
    const { engine, searched, games } = fakeEngine(() => 25, (fen) => (fen === START_FEN ? "e2e4" : null));
    const progress: number[] = [];
    const evals = await analyseGame(engine, tl.fens, { chess960: false, depth: 10, onProgress: (n) => progress.push(n) });

    expect(searched).toEqual(tl.fens);
    expect(games()).toBe(1);
    expect(progress).toEqual([1, 2, 3, 4]);
    expect(evals).toHaveLength(4);
    expect(evals[0]).toEqual({ score: { kind: "cp", cp: 25 }, best: "e2e4", depth: 10 });
  });

  it("feeds classifyGame end to end", async () => {
    // White-POV evals: 1.e4 and 1...e5 keep the balance, 2.Qh5?? hands Black a big edge.
    const cp = new Map<string, number>([[tl.fens[0]!, 20], [tl.fens[1]!, 20], [tl.fens[2]!, 20], [tl.fens[3]!, -400]]);
    const best = new Map<string, string>([[tl.fens[0]!, "e2e4"], [tl.fens[1]!, "c7c5"], [tl.fens[2]!, "g1f3"]]);
    const { engine } = fakeEngine((fen) => cp.get(fen) ?? 0, (fen) => best.get(fen) ?? null);

    const evals = await analyseGame(engine, tl.fens, { chess960: false, depth: 10 });
    const verdicts = classifyGame(tl.fens, tl.moves, evals);
    expect(verdicts.map((v) => v?.cls)).toEqual(["best", "best", "blunder"]);
  });

  it("scores checkmate without asking the engine", async () => {
    const mate = new PositionTimeline(START_FEN);
    mate.sync(["f2f3", "e7e5", "g2g4", "d8h4"]); // fool's mate
    const { engine, searched } = fakeEngine(() => 0);
    const evals = await analyseGame(engine, mate.fens, { chess960: false, depth: 6 });
    expect(evals.at(-1)?.score).toEqual({ kind: "checkmate", winner: "black" });
    expect(searched).toHaveLength(mate.fens.length - 1);
  });

  it("stops when aborted and returns the partial result", async () => {
    const controller = new AbortController();
    const { engine, searched } = fakeEngine(() => 0);
    const evals = await analyseGame(engine, tl.fens, {
      chess960: false, depth: 6, signal: controller.signal,
      onProgress: (n) => { if (n === 2) controller.abort(); },
    });
    expect(searched).toHaveLength(2);
    expect(evals.filter(Boolean)).toHaveLength(2);
  });

  it("stops when the engine reports a cancelled search", async () => {
    const engine: SearchEngine = {
      async newGame() {},
      async search() { return { cancelled: true, bestMove: null, lines: [] }; },
    };
    const evals = await analyseGame(engine, tl.fens, { chess960: false, depth: 6 });
    expect(evals.every((e) => e === undefined)).toBe(true);
  });
});
