import { describe, expect, it } from "vitest";
import { createGame } from "./createGame.js";
import { sanForNextMove } from "./notation.js";
import type { GameState } from "./types.js";

const CLOCK = { mode: "live" as const, initialMs: 60_000, incrementMs: 0 };

const game = (moves: string[] = [], initialFen?: string): GameState => ({
  ...createGame({ clock: CLOCK, now: 0, initialFen }),
  moves,
  ply: moves.length,
  turn: moves.length % 2 === 0 ? "white" : "black",
});

describe("sanForNextMove", () => {
  it("handles plain moves, pawn captures and castling", () => {
    expect(sanForNextMove(game(), "e2e4")).toBe("e4");
    expect(sanForNextMove(game(), "g1f3")).toBe("Nf3");
    expect(sanForNextMove(game(["e2e4", "d7d5"]), "e4d5")).toBe("exd5");
    const italian = ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6"];
    expect(sanForNextMove(game(italian), "e1g1")).toBe("O-O");
  });

  it("handles promotions", () => {
    const fen = "8/P6k/8/8/8/8/8/K7 w - - 0 1";
    expect(sanForNextMove(game([], fen), "a7a8q")).toBe("a8=Q");
    expect(sanForNextMove(game([], fen), "a7a8n")).toBe("a8=N");
  });

  it("disambiguates", () => {
    const fen = "4k3/8/8/8/8/8/8/1N2KN2 w - - 0 1";
    expect(sanForNextMove(game([], fen), "b1d2")).toBe("Nbd2");
    expect(sanForNextMove(game([], fen), "f1d2")).toBe("Nfd2");
  });

  it("adds check and mate suffixes", () => {
    expect(sanForNextMove(game([], "4k3/8/8/8/8/8/R7/4K3 w - - 0 1"), "a2a8")).toBe("Ra8+");
    const scholars = ["e2e4", "e7e5", "f1c4", "b8c6", "d1h5", "g8f6"];
    expect(sanForNextMove(game(scholars), "h5f7")).toBe("Qxf7#");
  });

  it("returns null instead of guessing", () => {
    expect(sanForNextMove(game(), "e2e5")).toBeNull(); // illegal
    expect(sanForNextMove(game(), "e7e5")).toBeNull(); // wrong side's piece
    expect(sanForNextMove(game(), "zzzz")).toBeNull(); // unparseable
    expect(sanForNextMove(game(["e2e5"]), "g1f3")).toBeNull(); // history doesn't replay
    expect(sanForNextMove(game([], "not a fen"), "e2e4")).toBeNull(); // bad start position
  });
});