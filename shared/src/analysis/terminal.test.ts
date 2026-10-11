import { describe, expect, it } from "vitest";
import { terminalScore } from "./terminal.js";

describe("terminalScore", () => {
  it("is null for an ongoing game", () => {
    expect(terminalScore("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1")).toBeNull();
  });
  it("names the winner of a checkmate (fool's mate: Black wins)", () => {
    expect(terminalScore("rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3"))
      .toEqual({ kind: "checkmate", winner: "black" });
  });
  it("scores stalemate and bare kings as a draw", () => {
    expect(terminalScore("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1")).toEqual({ kind: "cp", cp: 0 });
    expect(terminalScore("8/8/8/4k3/8/3K4/8/8 w - - 0 1")).toEqual({ kind: "cp", cp: 0 });
  });
  it("is null for an unparseable FEN", () => {
    expect(terminalScore("nope")).toBeNull();
  });
});
