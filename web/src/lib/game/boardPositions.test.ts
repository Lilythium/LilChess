import { describe, expect, it } from "vitest";
import { Chess } from "chessops/chess";
import { makeUci } from "chessops/util";
import { createGame, fenOf, replay, VARIANTS, startFenFor, type GameState, type Variant } from "@lilchess/shared";
import { createBoardPositions } from "./boardPositions";

// A deterministic pseudo-random legal game, so the equivalence checks cover captures, castling, promotion, checks.
function randomLine(plies: number, seed: number): string[] {
  let s = seed;
  const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const pos = Chess.default();
  const moves: string[] = [];
  while (moves.length < plies && !pos.isEnd()) {
    const all: { from: number; to: number; promotion?: "queen" }[] = [];
    for (const [from, dests] of pos.allDests()) for (const to of dests) all.push({ from, to });
    const m = all[Math.floor(rnd() * all.length)]!;
    if (pos.board.get(m.from)?.role === "pawn" && (m.to < 8 || m.to > 55)) m.promotion = "queen";
    moves.push(makeUci(m));
    pos.play(m);
  }
  return moves;
}

function gameWith(moves: string[], variant: Variant = "standard"): GameState {
  const game = createGame({ clock: { mode: "live", initialMs: 60_000, incrementMs: 0 }, now: 0, variant });
  return { ...game, moves: [...moves], ply: moves.length };
}

const fenAfterReplay = (game: GameState): string => {
  const r = replay(game);
  if (!r.ok) throw new Error(r.error);
  return fenOf(r.position);
};

describe("createBoardPositions", () => {
  it("gives the same position as replaying the game, at every ply", () => {
    const moves = randomLine(120, 7);
    const game = gameWith(moves);
    const positions = createBoardPositions();
    for (let ply = 0; ply <= moves.length; ply++) {
      const want = fenAfterReplay({ ...game, moves: moves.slice(0, ply), ply });
      expect(fenOf(positions.at(game, ply)!)).toBe(want);
    }
  });

  it("follows a game as moves arrive one at a time", () => {
    const moves = randomLine(60, 11);
    const positions = createBoardPositions();
    for (let n = 0; n <= moves.length; n++) {
      const game = gameWith(moves.slice(0, n));
      expect(fenOf(positions.at(game, n)!)).toBe(fenAfterReplay(game));
    }
  });

  it("follows a takeback and a different continuation", () => {
    const positions = createBoardPositions();
    positions.at(gameWith(["e2e4", "e7e5", "g1f3", "b8c6"]), 4);

    const back = gameWith(["e2e4", "e7e5"]);
    expect(fenOf(positions.at(back, 2)!)).toBe(fenAfterReplay(back));

    const other = gameWith(["e2e4", "c7c5", "g1f3"]);
    expect(fenOf(positions.at(other, 3)!)).toBe(fenAfterReplay(other));
  });

  it("returns a fresh position each time, so callers may mutate it", () => {
    const game = gameWith(["e2e4", "e7e5"]);
    const positions = createBoardPositions();
    const first = positions.at(game, 2)!;
    first.play({ from: 6, to: 21 }); // g1f3, applied to the caller's copy only
    expect(fenOf(positions.at(game, 2)!)).toBe(fenAfterReplay(game));
  });

  it("returns null past what the recorded moves allow, and for an illegal move", () => {
    const positions = createBoardPositions();
    expect(positions.at(gameWith(["e2e4"]), 5)).toBeNull();
    expect(positions.at(gameWith(["e2e4", "e2e4"]), 2)).toBeNull();
    // the part before the illegal move is still playable
    expect(positions.at(gameWith(["e2e4", "e2e4"]), 1)).not.toBeNull();
  });

  it("returns null instead of throwing for a broken start position", () => {
    const game = { ...gameWith([]), initialFen: "not a fen" };
    expect(createBoardPositions().at(game, 0)).toBeNull();
  });

  it.each(VARIANTS.filter((v) => v !== "chess960"))("matches replay in %s", (variant) => {
    // Captures on purpose: Crazyhouse fills its pockets, and Antichess requires the captures to be played.
    const moves = ["e2e4", "d7d5", "e4d5", "d8d5"];
    const start = startFenFor(variant);
    const game = { ...gameWith(moves, variant), initialFen: start };
    const positions = createBoardPositions();
    expect(fenOf(positions.at(game, moves.length)!)).toBe(fenAfterReplay(game));
  });
});
