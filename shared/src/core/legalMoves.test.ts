import { describe, expect, it } from "vitest";
import { START_FEN } from "./types.js";
import { legalMoves } from "./legalMoves.js";

describe("legalMoves", () => {
  it("lists the 20 opening moves", () => {
    const moves = legalMoves(START_FEN);
    expect(moves).toHaveLength(20);
    expect(moves.some((m) => m.capture || m.checkmate)).toBe(false);
    expect(moves.map((m) => m.uci)).toContain("e2e4");
  });

  it("flags captures, including en passant", () => {
    const capture = legalMoves("rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2");
    expect(capture.find((m) => m.uci === "e4d5")?.capture).toBe(true);
    expect(capture.find((m) => m.uci === "e4e5")?.capture).toBe(false);
    const ep = legalMoves("rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3");
    expect(ep.find((m) => m.uci === "e5f6")?.capture).toBe(true);
  });

  it("flags a checkmating move", () => {
    const mate = legalMoves("rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq g3 0 2");
    expect(mate.filter((m) => m.checkmate).map((m) => m.uci)).toEqual(["d8h4"]);
  });

  it("offers every promotion piece and nothing on a finished position", () => {
    const promo = legalMoves("8/P6k/8/8/8/8/8/K7 w - - 0 1").filter((m) => m.uci.startsWith("a7a8"));
    expect(promo.map((m) => m.uci).sort()).toEqual(["a7a8b", "a7a8n", "a7a8q", "a7a8r"]);
    expect(legalMoves("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1")).toEqual([]);
  });
});
