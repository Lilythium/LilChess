import { describe, expect, it } from "vitest";
import { START_FEN } from "@lilchess/shared";
import { commonPrefix, playOnLine } from "./line";

describe("commonPrefix", () => {
  it("counts shared leading moves", () => {
    expect(commonPrefix(["e2e4", "e7e5"], ["e2e4", "c7c5"])).toBe(1);
    expect(commonPrefix(["e2e4"], ["e2e4", "e7e5"])).toBe(1);
    expect(commonPrefix([], ["e2e4"])).toBe(0);
  });
});

describe("playOnLine", () => {
  const line = ["e2e4", "e7e5", "g1f3"];
  const afterE4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";

  it("keeps the line when the user plays the move that is already next", () => {
    expect(playOnLine(line, 1, "e7e5", afterE4)).toBe(line);
  });
  it("starts a sideline by cutting the line at the branch point", () => {
    expect(playOnLine(line, 1, "c7c5", afterE4)).toEqual(["e2e4", "c7c5"]);
  });
  it("appends when playing from the end of the line", () => {
    expect(playOnLine(line, 3, "b8c6", "unused")).toEqual([...line, "b8c6"]);
  });
  it("works from the start position", () => {
    expect(playOnLine([], 0, "d2d4", START_FEN)).toEqual(["d2d4"]);
  });
  it("treats castling spelled either way as the same move", () => {
    const fen = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
    const l = ["e1h1"];
    expect(playOnLine(l, 0, "e1g1", fen)).toBe(l);
  });
});

describe("playOnLine in variants", () => {
  const fen = "rnbqkb1r/ppp1pppp/5n2/3P4/8/8/PPPP1PPP/RNBQKBNR[P] w KQkq - 1 3";

  it("steps forward when the same drop is replayed", () => {
    const line = ["P@e4", "e7e6"];
    expect(playOnLine(line, 0, "P@e4", fen, "crazyhouse")).toBe(line);
  });

  it("starts a sideline when a different drop is played", () => {
    expect(playOnLine(["P@e4", "e7e6"], 0, "P@e5", fen, "crazyhouse")).toEqual(["P@e5"]);
  });

  it("appends a drop at the end of the line", () => {
    expect(playOnLine([], 0, "P@e4", fen, "crazyhouse")).toEqual(["P@e4"]);
  });
});
