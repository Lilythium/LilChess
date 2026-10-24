import { describe, expect, it } from "vitest";
import { makeUci, squareRank } from "chessops/util";
import type { Position } from "chessops/chess";
import { applyMove } from "./applyMove.js";
import { createGame } from "./createGame.js";
import { fenAfterMoves } from "./fen.js";
import { fenOf, positionFromFen } from "./position.js";
import { makeSeed, positionKey, replay, SNAPSHOT_INTERVAL, type ReplaySeed } from "./replay.js";
import { VARIANTS, type GameState, type Variant } from "./types.js";

const CLOCK = { mode: "live", initialMs: 3 * 3_600_000, incrementMs: 0 } as const;
const T0 = 1_000_000;

function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomMove(pos: Position, rnd: () => number): string | null {
  const all: string[] = [];
  for (const [from, dests] of pos.allDests()) {
    const isPawn = pos.board.get(from)?.role === "pawn";
    for (const to of dests) {
      const last = squareRank(to) === 0 || squareRank(to) === 7;
      all.push(makeUci({ from, to, promotion: isPawn && last ? "queen" : undefined }));
    }
  }
  if (pos.rules === "crazyhouse") {
    const pocket = pos.pockets?.[pos.turn];
    for (const role of ["pawn", "knight", "bishop", "rook", "queen"] as const) {
      if (!pocket || pocket[role] <= 0) continue;
      for (const to of pos.dropDests()) {
        if (role === "pawn" && (squareRank(to) === 0 || squareRank(to) === 7)) continue;
        all.push(makeUci({ role, to }));
      }
    }
  }
  return all.length ? all[Math.floor(rnd() * all.length)]! : null;
}

// Plays random moves and, at every ply, checks that a checkpoint-seeded applyMove agrees with the full replay.
function playAndCompare(variant: Variant, seedNo: number, maxPlies: number): number {
  const rnd = rng(seedNo);
  let game: GameState = createGame({ clock: CLOCK, variant, now: T0 });
  const checkpoints: ReplaySeed[] = [];
  let compared = 0;

  while (game.status === "started" && game.ply < maxPlies) {
    const pos = positionFromFen(fenAfterMoves(game.initialFen, game.moves, variant)!, variant);
    const uci = randomMove(pos, rnd);
    if (!uci) break;
    const now = T0 + (game.ply + 1) * 1000;

    const full = applyMove(game, uci, now);
    // Seed from the newest checkpoint at or before this ply, exactly as the server does.
    const seed = checkpoints.at(-1);
    const seeded = applyMove(game, uci, now, seed);

    expect(seeded, `${variant} seed ${seedNo} ply ${game.ply}`).toEqual(full);
    compared++;
    if (!full.ok) break;
    if (full.snapshot) {
      checkpoints.push(full.snapshot);
      expect(full.snapshot.ply % SNAPSHOT_INTERVAL).toBe(0);
    }
    game = full.state;
  }
  return compared;
}

describe("checkpoint-seeded replay", () => {
  for (const variant of VARIANTS) {
    it(`matches the full replay move for move in ${variant}`, () => {
      let compared = 0;
      for (let s = 1; s <= 3; s++) compared += playAndCompare(variant, s * 101, 260);
      expect(compared).toBeGreaterThan(100);
    });
  }

  it("emits a checkpoint exactly on interval plies and never when the game ends", () => {
    const rnd = rng(7);
    let game = createGame({ clock: CLOCK, now: T0 });
    const seen: number[] = [];
    while (game.status === "started" && game.ply < 160) {
      const uci = randomMove(positionFromFen(fenAfterMoves(game.initialFen, game.moves)!), rnd)!;
      const r = applyMove(game, uci, T0 + (game.ply + 1) * 1000);
      if (!r.ok) throw new Error(r.error);
      if (r.snapshot) seen.push(r.snapshot.ply);
      else expect(r.state.ply % SNAPSHOT_INTERVAL !== 0 || r.state.status !== "started").toBe(true);
      game = r.state;
    }
    expect(seen).toEqual([50, 100, 150].filter((p) => p <= game.ply));
  });

  it("still detects threefold repetition when the repeated positions straddle the checkpoint", () => {
    // Knight shuffle: the start position recurs every 4 plies. Checkpoint at ply 6, repetition completes at ply 8.
    const shuffle = ["g1f3", "g8f6", "f3g1", "f6g8", "g1f3", "g8f6", "f3g1", "f6g8"];
    let g = createGame({ clock: CLOCK, now: T0 });
    let seed: ReplaySeed | undefined;
    shuffle.forEach((uci, i) => {
      const r = applyMove(g, uci, T0 + (i + 1) * 1000, seed);
      if (!r.ok) throw new Error(r.error);
      g = r.state;
      if (g.ply === 6) {
        const full = replay(g);
        if (!full.ok) throw new Error(full.error);
        seed = makeSeed(fenOf(full.position), full.position.halfmoves, g.ply, full.positionKeys);
      }
    });
    expect(g.status).toBe("finished");
    expect(g.termination).toBe("repetition");
  });

  it("ignores a damaged checkpoint and falls back to the full replay", () => {
    const rnd = rng(3);
    let game = createGame({ clock: CLOCK, now: T0 });
    for (let i = 0; i < 60; i++) {
      const uci = randomMove(positionFromFen(fenAfterMoves(game.initialFen, game.moves)!), rnd)!;
      const r = applyMove(game, uci, T0 + (i + 1) * 1000);
      if (!r.ok) throw new Error(r.error);
      game = r.state;
    }
    const good = replay(game);
    if (!good.ok) throw new Error(good.error);
    const real = fenAfterMoves(game.initialFen, game.moves.slice(0, 50))!;
    const bad: ReplaySeed[] = [
      { ply: 50, fen: "not a fen", keys: ["x"] },
      { ply: 50, fen: real, keys: ["wrong key"] },
      { ply: 50, fen: real, keys: [] },
      { ply: 999, fen: real, keys: [positionKey(positionFromFen(real))] },
    ];
    for (const seed of bad) {
      const r = replay(game, seed);
      expect(r.ok).toBe(true);
      if (r.ok) expect(fenOf(r.position)).toBe(fenOf(good.position));
    }
  });
});
