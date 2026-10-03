import { makeSan } from "chessops/san";
import { parseUci } from "chessops/util";
import { replay } from "./replay.js";
import type { GameState } from "./types.js";

// SAN for the move about to be played, computed from the state *before* it's applied.
// Returns null if the history can't be replayed or the move isn't legal in that position,
// so a non-null result always means "this is a real SAN for a legal move".
export function sanForNextMove(game: GameState, uci: string): string | null {
  const replayed = replay(game);
  if (!replayed.ok) return null;
  const move = parseUci(uci);
  if (!move || !replayed.position.isLegal(move)) return null;
  return makeSan(replayed.position, move);
}