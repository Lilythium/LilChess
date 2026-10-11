import { describe, expect, it } from "vitest";
import { parseBestMove, parseInfoLine } from "./uci.js";

// Lines captured from stockfish-18-lite-single (UCI_ShowWDL on).
describe("parseInfoLine", () => {
  it("parses a normal search line", () => {
    const info = parseInfoLine(
      "info depth 12 seldepth 19 multipv 1 score cp -37 wdl 5 913 82 nodes 29760 nps 173023 hashfull 8 time 172 pv e7e5 g1f3 b8c6 d2d4",
    );
    expect(info).toEqual({
      depth: 12, multipv: 1, score: { kind: "cp", cp: -37 },
      pv: ["e7e5", "g1f3", "b8c6", "d2d4"], nodes: 29760, nps: 173023, bound: undefined,
    });
  });
  it("parses mate scores and multipv", () => {
    const info = parseInfoLine("info depth 12 seldepth 2 multipv 2 score mate 1 nodes 240 nps 34285 time 7 pv a1a8");
    expect(info?.score).toEqual({ kind: "mate", moves: 1 });
    expect(info?.multipv).toBe(2);
  });
  it("flags bound scores", () => {
    expect(parseInfoLine("info depth 9 multipv 1 score cp 50 lowerbound pv e2e4")?.bound).toBe("lower");
    expect(parseInfoLine("info depth 9 multipv 1 score cp 50 upperbound pv e2e4")?.bound).toBe("upper");
  });
  it("ignores lines that are not a PV report", () => {
    expect(parseInfoLine("info depth 0 score mate 0")).toBeNull(); // terminal position, no pv
    expect(parseInfoLine("info string NNUE evaluation using nn-xxxx.nnue")).toBeNull();
    expect(parseInfoLine("info currmove e2e4 currmovenumber 1")).toBeNull();
    expect(parseInfoLine("uciok")).toBeNull();
    expect(parseInfoLine("info depth x score cp 10 pv e2e4")).toBeNull();
  });
});

describe("parseBestMove", () => {
  it("parses the move and ignores ponder", () => {
    expect(parseBestMove("bestmove e7e5 ponder g1f3")).toEqual({ move: "e7e5" });
  });
  it("returns a null move for a finished position", () => {
    expect(parseBestMove("bestmove (none)")).toEqual({ move: null });
  });
  it("returns null for other lines", () => {
    expect(parseBestMove("readyok")).toBeNull();
  });
});
