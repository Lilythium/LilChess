import { describe, expect, it } from "vitest";
import { formatPv, pvToSan, sameMove } from "./pv.js";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";

describe("pvToSan", () => {
  it("converts a UCI line and stops at the first illegal move", () => {
    expect(pvToSan(START, ["e2e4", "e7e5", "g1f3"])).toEqual(["e4", "e5", "Nf3"]);
    expect(pvToSan(START, ["e2e4", "e7e5", "e2e4", "d7d5"])).toEqual(["e4", "e5"]);
  });
  it("returns [] for a bad FEN", () => {
    expect(pvToSan("nonsense", ["e2e4"])).toEqual([]);
  });
  it("writes castling as O-O whichever way the engine spells it", () => {
    const fen = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
    expect(pvToSan(fen, ["e1g1"])).toEqual(["O-O"]);
    expect(pvToSan(fen, ["e1h1"])).toEqual(["O-O"]);
  });
});

describe("formatPv", () => {
  it("numbers moves from White's turn", () => {
    expect(formatPv(START, ["e2e4", "e7e5", "g1f3"])).toBe("1.e4 e5 2.Nf3");
  });
  it("uses the ellipsis when Black moves first", () => {
    expect(formatPv(AFTER_E4, ["e7e5", "g1f3", "b8c6"])).toBe("1...e5 2.Nf3 Nc6");
  });
  it("caps the length", () => {
    expect(formatPv(START, ["e2e4", "e7e5", "g1f3", "b8c6"], 2)).toBe("1.e4 e5");
  });
});

describe("sameMove", () => {
  const fen = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
  it("treats both castling spellings as the same move", () => {
    expect(sameMove(fen, "e1g1", "e1h1")).toBe(true);
  });
  it("tells different moves apart", () => {
    expect(sameMove(fen, "e1g1", "e1f1")).toBe(false);
    expect(sameMove(fen, "e1g1", "a1a8")).toBe(false);
  });
  it("is false for illegal input", () => {
    expect(sameMove(fen, "e1g1", "zzzz")).toBe(false);
  });
});

describe("sameMove in variants", () => {
  const pocketFen = "rnbqkb1r/ppp1pppp/5n2/3P4/8/8/PPPP1PPP/RNBQKBNR[P] w KQkq - 1 3";

  it("recognises the same Crazyhouse drop, and tells different drops apart", () => {
    expect(sameMove(pocketFen, "P@e4", "P@e4", "crazyhouse")).toBe(true);
    expect(sameMove(pocketFen, "P@e4", "P@e5", "crazyhouse")).toBe(false);
  });

  it("rejects a drop that is illegal (nothing in the pocket) instead of throwing", () => {
    expect(sameMove(pocketFen, "N@e4", "P@e4", "crazyhouse")).toBe(false);
  });

  it("treats a drop as illegal in standard chess", () => {
    expect(sameMove(pocketFen.replace("[P]", ""), "P@e4", "P@e5")).toBe(false);
  });

  it("returns false for an unreadable position rather than throwing", () => {
    expect(sameMove("not a fen", "e2e4", "e2e3", "antichess")).toBe(false);
  });
});
