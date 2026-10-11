// Runs the real Stockfish 18 lite WASM build under Node (the same binary the browser
// worker loads), so a wrong UCI assumption fails here instead of in someone's browser.
//
// Node-only quirks, which do NOT apply to the browser Worker:
//  - the Node wrapper can only be instantiated once per process, so all tests share one engine;
//  - its "quit" command calls process.exit(), so terminate() is a no-op here.
import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PositionTimeline, START_FEN, classifyGame, gameAccuracy, summariseVerdicts } from "@lilchess/shared";
import { Engine, type EngineTransport } from "./engine";
import { AnalysisCache, type StoreLike } from "./cache";
import { analyseGame } from "./gameAnalysis";
import { parseAnalysisInput } from "./importText";
import { gameCacheKey } from "./loadedGame";

const require = createRequire(import.meta.url);

async function nodeTransport(): Promise<EngineTransport> {
  const init = require("stockfish") as (variant: string) => Promise<{
    sendCommand(cmd: string): void;
    listener: (line: string) => void;
  }>;
  const raw = await init("lite-single");
  let listener: (line: string) => void = () => {};
  raw.listener = (line) => listener(String(line));
  return {
    send: (c) => raw.sendCommand(c),
    onLine: (l) => (listener = l),
    onError: () => {},
    terminate: () => {},
  };
}

describe("Engine with the real Stockfish WASM", () => {
  let engine: Engine;
  beforeAll(async () => {
    engine = new Engine(await nodeTransport());
    await engine.init();
  }, 60_000);
  afterAll(() => engine?.dispose());

  it("finds mate in one and reports it from White's side", async () => {
    const mate = await engine.search({ fen: "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1", chess960: false, depth: 10 });
    expect(mate.cancelled).toBe(false);
    expect(mate.bestMove).toBe("a1a8");
    expect(mate.lines[0]!.score).toEqual({ kind: "mate", moves: 1 });
    expect(mate.lines[0]!.pv[0]).toBe("a1a8");
  }, 60_000);

  it("flips a raw Black-to-move mate into White's point of view", async () => {
    // Black to move and mates in one with ...Rb1#: raw "mate 1" must become White's "mate -1".
    const black = await engine.search({ fen: "1r4k1/8/8/8/8/8/5PPP/6K1 b - - 0 1", chess960: false, depth: 10 });
    expect(black.bestMove).toBe("b8b1");
    expect(black.lines[0]!.score).toEqual({ kind: "mate", moves: -1 });
  }, 60_000);

  it("returns sorted MultiPV lines", async () => {
    const r = await engine.search({ fen: START_FEN, chess960: false, depth: 8, multipv: 3 });
    expect(r.lines.map((l) => l.multipv)).toEqual([1, 2, 3]);
    expect(new Set(r.lines.map((l) => l.pv[0])).size).toBe(3);
  }, 60_000);

  it("searches Chess960 positions", async () => {
    const r = await engine.search({
      fen: "nrkbbnqr/pppppppp/8/8/8/8/PPPPPPPP/NRKBBNQR w KQkq - 0 1", chess960: true, depth: 6,
    });
    expect(r.cancelled).toBe(false);
    expect(r.bestMove).toMatch(/^[a-h][1-8][a-h][1-8]/);
    await engine.search({ fen: START_FEN, chess960: false, depth: 1 }); // leave the engine in standard mode
  }, 60_000);

  it("analyses a whole short game and flags the blunder", async () => {
    const tl = new PositionTimeline(START_FEN);
    tl.sync(["e2e4", "e7e5", "d1h5", "b8c6", "f1c4", "g8f6", "h5f7"]); // 3...Nf6?? allows Qxf7#
    const evals = await analyseGame(engine, tl.fens, { chess960: false, depth: 10 });

    expect(evals.every(Boolean)).toBe(true);
    expect(evals.at(-1)!.score).toEqual({ kind: "checkmate", winner: "white" });

    const verdicts = classifyGame(tl.fens, tl.moves, evals);
    expect(verdicts[5]?.cls).toBe("blunder"); // ply 6, 3...Nf6, walks into mate in one
  }, 120_000);

  it("pasted PGN -> analysis -> accuracy -> cache round trip", async () => {
    // Includes castling (parsed as king-takes-rook) and some real moves to grade.
    const parsed = parseAnalysisInput(`[White "Alice"]\n[Black "Bob"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O Nf6 5. d3 O-O 6. Bg5 h6 7. Bxf6 Qxf6 8. Nc3 Qd8 9. Nd5 *`);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const tl = new PositionTimeline(parsed.game.initialFen);
    expect(tl.sync(parsed.game.moves)).toBe(true);
    const evals = await analyseGame(engine, tl.fens, { chess960: false, depth: 8 });
    expect(evals.every(Boolean)).toBe(true);

    const verdicts = classifyGame(tl.fens, tl.moves, evals);
    const accuracy = gameAccuracy(verdicts);
    expect(accuracy.white).toBeGreaterThan(0);
    expect(accuracy.white).toBeLessThanOrEqual(100);
    expect(accuracy.black).toBeGreaterThan(0);
    const counts = summariseVerdicts(verdicts);
    expect(counts.white.inaccuracy + counts.white.mistake + counts.white.blunder).toBeGreaterThanOrEqual(0);

    const data = new Map<string, string>();
    const store: StoreLike = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
    const cache = new AnalysisCache(store);
    const key = gameCacheKey(undefined, parsed.game);
    expect(cache.save(key, 8, evals)).toBe(true);

    const restored = cache.load(key, tl.fens.length)!;
    expect(restored.evals).toEqual(evals);
    expect(gameAccuracy(classifyGame(tl.fens, tl.moves, restored.evals))).toEqual(accuracy); // identical after the round trip
  }, 120_000);
});
