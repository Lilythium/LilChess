import { describe, expect, it } from "vitest";
import { PositionTimeline } from "./timeline.js";
import { fensForMoves } from "./fen.js";
import { START_FEN } from "./types.js";
import { chess960Fen } from "./variants.js";

describe("PositionTimeline", () => {
  it("matches fensForMoves and produces SANs", () => {
    const moves = ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5"];
    const tl = new PositionTimeline(START_FEN);
    expect(tl.sync(moves)).toBe(true);
    expect(tl.fens).toEqual(fensForMoves(START_FEN, moves));
    expect(tl.sans).toEqual(["e4", "e5", "Nf3", "Nc6", "Bb5"]);
    expect(tl.squares[1]).toEqual(["e2", "e4"]);
    expect(tl.squares[0]).toBeNull();
    expect(tl.length).toBe(5);
  });

  it("extends incrementally without touching earlier entries", () => {
    const tl = new PositionTimeline(START_FEN);
    tl.sync(["e2e4", "e7e5"]);
    const before = [...tl.fens];
    tl.sync(["e2e4", "e7e5", "g1f3"]);
    expect(tl.fens.slice(0, 3)).toEqual(before);
    expect(tl.fens).toHaveLength(4);
  });

  it("truncates on a takeback and rebuilds a different continuation", () => {
    const tl = new PositionTimeline(START_FEN);
    tl.sync(["e2e4", "e7e5", "g1f3"]);
    tl.sync(["e2e4"]);
    expect(tl.length).toBe(1);
    expect(tl.sans).toEqual(["e4"]);
    tl.sync(["e2e4", "c7c5"]);
    expect(tl.sans).toEqual(["e4", "c5"]);
    expect(tl.fens).toEqual(fensForMoves(START_FEN, ["e2e4", "c7c5"]));
  });

  it("stops before an illegal move and reports it", () => {
    const tl = new PositionTimeline(START_FEN);
    expect(tl.sync(["e2e4", "e2e4"])).toBe(false);
    expect(tl.moves).toEqual(["e2e4"]);
  });

  it("highlights castling as king start to king end, for either spelling", () => {
    const fen = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
    for (const castle of ["e1g1", "e1h1"]) {
      const tl = new PositionTimeline(fen);
      tl.sync([castle]);
      expect(tl.sans).toEqual(["O-O"]);
      expect(tl.squares[1]).toEqual(["e1", "g1"]);
    }
  });

  it("handles Chess960 starts, including castling by king-takes-rook", () => {
    const fen = chess960Fen(518 + 1); // any non-standard arrangement
    const tl = new PositionTimeline(fen);
    expect(tl.fens[0]).toBeTruthy();
    expect(tl.sync([])).toBe(true);
  });

  it("rejects a bad initial FEN", () => {
    expect(() => new PositionTimeline("garbage")).toThrow("invalid_initial_fen");
  });

  it("promotion squares and SAN", () => {
    const tl = new PositionTimeline("8/P6k/8/8/8/8/8/K7 w - - 0 1");
    tl.sync(["a7a8q"]);
    expect(tl.sans).toEqual(["a8=Q"]);
    expect(tl.squares[1]).toEqual(["a7", "a8"]);
  });
});
