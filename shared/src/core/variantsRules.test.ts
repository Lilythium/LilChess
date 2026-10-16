import { describe, expect, it } from "vitest";
import { applyMove } from "./applyMove.js";
import { createGame } from "./createGame.js";
import { fenAfterMoves, fensForMoves } from "./fen.js";
import { buildPgn } from "./pgn.js";
import { sanForNextMove } from "./notation.js";
import { fixedStartFen } from "./position.js";
import { PositionTimeline } from "./timeline.js";
import { VARIANTS, type GameState, type Variant } from "./types.js";
import { startFenFor } from "./variants.js";

const CLOCK = { mode: "live", initialMs: 300_000, incrementMs: 0 } as const;
const T0 = 1_000_000;

function newGame(variant: Variant, initialFen?: string): GameState {
  return createGame({ clock: CLOCK, variant, initialFen, now: T0 });
}

/** Plays UCI moves, failing the test on the first rejected one. */
function play(game: GameState, moves: string[]): GameState {
  let g = game;
  moves.forEach((uci, i) => {
    const r = applyMove(g, uci, T0 + (i + 1) * 1000);
    if (!r.ok) throw new Error(`move ${i + 1} ${uci} rejected: ${r.error}`);
    g = r.state;
  });
  return g;
}

describe("variant registry", () => {
  it("every variant has a legal start position", () => {
    for (const v of VARIANTS) {
      expect(fenAfterMoves(startFenFor(v), [], v), v).not.toBeNull();
    }
  });

  it("Crazyhouse and Three-check start positions carry their extra state", () => {
    expect(fixedStartFen("crazyhouse")).toContain("[]");
    expect(fixedStartFen("threecheck")).toMatch(/3\+3|\+0\+0/);
  });
});

describe("Three-check", () => {
  // 1.e4 e5 2.Bc4 Nc6 3.Bxf7+ Kxf7 4.Qh5+ Ke7 (second check) 5.Qxe5+ (third check)
  const moves = ["e2e4", "e7e5", "f1c4", "b8c6", "c4f7", "e8f7", "d1h5", "f7e7", "h5e5"];

  it("ends the game on the third check, not on mate", () => {
    const g = play(newGame("threecheck"), moves);
    expect(g.status).toBe("finished");
    expect(g.result).toBe("1-0");
    expect(g.termination).toBe("three_check");
  });

  it("does not end after two checks", () => {
    const g = play(newGame("threecheck"), moves.slice(0, -1));
    expect(g.status).toBe("started");
  });

  it("tracks the remaining checks in the FEN", () => {
    const fen = fenAfterMoves(fixedStartFen("threecheck"), moves.slice(0, 5), "threecheck")!;
    expect(fen).toMatch(/2\+3|\+1\+0/); // white has given one check
  });
});

describe("Antichess", () => {
  it("lets a player capture the king-less way: captures are compulsory", () => {
    const g = play(newGame("antichess"), ["e2e4", "d7d5"]);
    // white now must capture: only exd5 is legal besides nothing else capturing
    const r = applyMove(g, "a2a3", T0 + 10_000);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toBe("illegal_move");
    expect(applyMove(g, "e4d5", T0 + 10_000).ok).toBe(true);
  });

  it("allows promotion to king", () => {
    const fen = "8/P7/8/8/8/8/8/7k w - - 0 1"; // antichess: pawn promotes, kings are ordinary pieces
    const r = applyMove(newGame("antichess", fen), "a7a8k", T0 + 1000);
    expect(r.ok).toBe(true);
  });

  it("is won by the side that loses all its pieces", () => {
    // Black pawn b3 must capture the white knight on a2: white has nothing left, so white wins.
    const g = play(newGame("antichess", "7k/8/8/8/8/1p6/N7/8 b - - 0 1"), ["b3a2"]);
    expect(g.status).toBe("finished");
    expect(g.result).toBe("1-0");
    expect(g.termination).toBe("variant_end");
  });

  it("is won by the side that is stalemated", () => {
    // Black's a4-a3 blocks White's only piece (the a2 pawn): White has no move, so White wins.
    const g = play(newGame("antichess", "8/8/8/8/p7/8/P7/8 b - - 0 1"), ["a4a3"]);
    expect(g.status).toBe("finished");
    expect(g.result).toBe("1-0");
    expect(g.termination).toBe("variant_end");
  });
});

describe("Crazyhouse", () => {
  // 1.e4 d5 2.exd5 -> white pocket holds a pawn; white can drop it later
  it("puts captured pieces in the capturer's pocket and allows a drop", () => {
    let g = play(newGame("crazyhouse"), ["e2e4", "d7d5", "e4d5"]);
    expect(fenAfterMoves(g.initialFen, g.moves, "crazyhouse")).toMatch(/\[P\]/);
    g = play(g, ["g8f6"]);
    const dropped = applyMove(g, "P@e4", T0 + 20_000);
    expect(dropped.ok).toBe(true);
    expect(fenAfterMoves(g.initialFen, [...g.moves, "P@e4"], "crazyhouse")).not.toMatch(/\[P\]/);
  });

  it("rejects dropping a piece you do not hold, and dropping on an occupied square", () => {
    const g = play(newGame("crazyhouse"), ["e2e4", "d7d5", "e4d5", "g8f6"]);
    expect(applyMove(g, "N@e4", T0 + 20_000).ok).toBe(false);
    expect(applyMove(g, "P@d5", T0 + 20_000).ok).toBe(false);
  });

  it("writes SAN for drops", () => {
    const g = play(newGame("crazyhouse"), ["e2e4", "d7d5", "e4d5", "g8f6"]);
    expect(sanForNextMove(g, "P@e4")).toBe("@e4");
  });

  it("is not a draw by insufficient material while pieces can still be dropped", () => {
    // K+P v K is not insufficient anyway; use a bare-kings board with a pocket piece.
    const fen = "4k3/8/8/8/8/8/8/4K3[Q] w - - 0 1";
    expect(applyMove(newGame("crazyhouse", fen), "e1d1", T0 + 1000).ok).toBe(true);
    expect(play(newGame("crazyhouse", fen), ["e1d1"]).status).toBe("started");
  });

  it("builds a timeline including drops", () => {
    const tl = new PositionTimeline(fixedStartFen("crazyhouse"), "crazyhouse");
    expect(tl.sync(["e2e4", "d7d5", "e4d5", "g8f6", "P@e4"])).toBe(true);
    expect(tl.sans.at(-1)).toBe("@e4");
    expect(tl.squares.at(-1)).toEqual(["e4", "e4"]);
  });
});

describe("PGN export", () => {
  it("adds Variant and FEN headers for variants", () => {
    const g = play(newGame("crazyhouse"), ["e2e4"]);
    const pgn = buildPgn({ game: g, sans: ["e4"], white: "a", black: "b", createdAt: T0 });
    expect(pgn).toContain('[Variant "Crazyhouse"]');
    expect(pgn).not.toContain("[FEN"); // start position is the variant's default
    const odd = buildPgn({ game: { ...g, initialFen: "4k3/8/8/8/8/8/8/4K3[Q] w - - 0 1" }, sans: [], white: "a", black: "b", createdAt: T0 });
    expect(odd).toContain("[FEN ");
  });
});

describe("fensForMoves", () => {
  it("returns one FEN per ply, drops included", () => {
    const fens = fensForMoves(fixedStartFen("crazyhouse"), ["e2e4", "d7d5", "e4d5", "g8f6", "P@e4"], "crazyhouse");
    expect(fens).toHaveLength(6);
  });
});
