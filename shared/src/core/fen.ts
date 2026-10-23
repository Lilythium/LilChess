import { parseUci } from "chessops/util";
import { fenOf, positionFromFen } from "./position.js";
import type { ReplaySeed } from "./replay.js";
import type { Variant } from "./types.js";

// FEN after replaying `moves` from `initialFen`, or null if anything is invalid.
// With a checkpoint only the moves after it are replayed; an unusable checkpoint falls back to the full replay.
export function fenAfterMoves(
  initialFen: string,
  moves: string[],
  variant: Variant = "standard",
  seed?: ReplaySeed,
): string | null {
  if (seed && seed.ply >= 1 && seed.ply <= moves.length) {
    const fromSeed = playFrom(seed.fen, moves.slice(seed.ply), variant);
    if (fromSeed !== null) return fromSeed;
  }
  return playFrom(initialFen, moves, variant);
}

function playFrom(startFen: string, moves: string[], variant: Variant): string | null {
  try {
    const pos = positionFromFen(startFen, variant);
    for (const uci of moves) {
      const move = parseUci(uci);
      if (!move || !pos.isLegal(move)) return null;
      pos.play(move);
    }
    return fenOf(pos);
  } catch {
    return null;
  }
}

// FEN after every ply (index 0 = the start position) from one replay, or null if anything is invalid.
export function fensForMoves(initialFen: string, moves: string[], variant: Variant = "standard"): string[] | null {
  try {
    const pos = positionFromFen(initialFen, variant);
    const fens = [fenOf(pos)];
    for (const uci of moves) {
      const move = parseUci(uci);
      if (!move || !pos.isLegal(move)) return null;
      pos.play(move);
      fens.push(fenOf(pos));
    }
    return fens;
  } catch {
    return null;
  }
}
