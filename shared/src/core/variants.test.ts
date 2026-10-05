import { Chess } from "chessops/chess";
import { parseFen } from "chessops/fen";
import { describe, expect, it } from "vitest";
import { applyMove } from "./applyMove.js";
import { createGame } from "./createGame.js";
import { fenAfterMoves } from "./fen.js";
import { sanForNextMove } from "./notation.js";
import { START_FEN } from "./types.js";
import { chess960Fen, randomChess960Fen } from "./variants.js";

const CLOCK = { mode: "live" as const, initialMs: 60_000, incrementMs: 0 };

describe("chess960Fen", () => {
  it("id 518 is the standard start position", () => {
    expect(chess960Fen(518)).toBe(START_FEN);
  });

  it("produces 960 distinct, legal start positions", () => {
    const seen = new Set<string>();
    for (let id = 0; id < 960; id++) {
      const fen = chess960Fen(id);
      seen.add(fen);
      expect(() => Chess.fromSetup(parseFen(fen).unwrap()).unwrap()).not.toThrow();

      const back = fen.split("/")[0]!;
      expect(fen.split("/")[7]?.split(" ")[0]).toBe(back.toUpperCase());
      const bishops = [...back].flatMap((c, i) => (c === "b" ? [i] : []));
      expect((bishops[0]! + bishops[1]!) % 2).toBe(1); // opposite-coloured bishops
      const rooks = [...back].flatMap((c, i) => (c === "r" ? [i] : []));
      const king = back.indexOf("k");
      expect(rooks[0]!).toBeLessThan(king);
      expect(king).toBeLessThan(rooks[1]!);
    }
    expect(seen.size).toBe(960);
  });

  it("rejects ids outside 0..959", () => {
    expect(() => chess960Fen(-1)).toThrow(RangeError);
    expect(() => chess960Fen(960)).toThrow(RangeError);
    expect(() => chess960Fen(1.5)).toThrow(RangeError);
  });

  it("maps the random source onto the id range", () => {
    expect(randomChess960Fen(() => 0)).toBe(chess960Fen(0));
    expect(randomChess960Fen(() => 0.9999)).toBe(chess960Fen(959));
  });
});

describe("createGame variants", () => {
  it("standard keeps the normal start; chess960 gets a valid scrambled one", () => {
    expect(createGame({ clock: CLOCK, now: 0 }).initialFen).toBe(START_FEN);
    const g = createGame({ clock: CLOCK, now: 0, variant: "chess960" });
    expect(g.variant).toBe("chess960");
    expect(fenAfterMoves(g.initialFen, [])).not.toBeNull();
  });
});

describe("chess960 castling", () => {
  // King on c1, rooks on a1 and h1: queenside castling leaves the king where it is.
  const FEN = "4k3/8/8/8/8/8/8/R1K4R w KQ - 0 1";
  const game = () => createGame({ clock: CLOCK, now: 0, variant: "chess960", initialFen: FEN });

  it("accepts king-takes-rook UCI and writes O-O / O-O-O", () => {
    expect(sanForNextMove(game(), "c1a1")).toBe("O-O-O");
    expect(sanForNextMove(game(), "c1h1")).toBe("O-O");
  });

  it("puts king and rook on the right squares", () => {
    expect(fenAfterMoves(FEN, ["c1a1"])).toBe("4k3/8/8/8/8/8/8/2KR3R b - - 1 1");
    expect(fenAfterMoves(FEN, ["c1h1"])).toBe("4k3/8/8/8/8/8/8/R4RK1 b - - 1 1");
  });

  it("plays through applyMove and rejects the ambiguous two-square form", () => {
    expect(applyMove(game(), "c1a1", 1_000).ok).toBe(true);
    expect(applyMove(game(), "c1g1", 1_000)).toEqual({ ok: false, error: "illegal_move" });
  });
});