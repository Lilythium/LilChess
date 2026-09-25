import { makeSan } from "chessops/san";
import { parseUci } from "chessops/util";
import { replay } from "./replay.js";
import type { GameState } from "./types.js";

// SAN for the move about to be played, computed from the state *before*
// it's applied. Only used for persistence — core rules never need SAN.
export function sanForNextMove(game: GameState, uci: string): string | null {
  const replayed = replay(game);
  if (!replayed.ok) return null;
  const move = parseUci(uci);
  if (!move) return null;
  return makeSan(replayed.position, move);
}