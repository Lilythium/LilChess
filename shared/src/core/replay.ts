import type { Position } from "chessops/chess";
import { parseUci } from "chessops/util";
import { fenOf, positionFromFen } from "./position.js";
import type { GameState } from "./types.js";

export type ReplayResult =
  | { ok: true; position: Position; positionKeys: string[] }
  | { ok: false; error: string };

// The repetition rule only cares about piece placement (and Crazyhouse pockets, which FEN writes into the
// placement field), side to move, castling rights, and en passant availability — not the halfmove or
// fullmove counters. Three-check also keys on the remaining checks, since the same board with a different
// check count is a different position.
export function positionKey(pos: Position): string {
  const base = fenOf(pos).split(" ").slice(0, 4).join(" ");
  return pos.remainingChecks ? `${base} ${pos.remainingChecks.white}+${pos.remainingChecks.black}` : base;
}

// Rebuilds the chessops position by replaying every move from
// initialFen. Pure: no I/O, never mutates the GameState it's given.
// Returns the position key after every ply (including ply 0, the
// starting position) so callers can check for repetition.
export function replay(game: GameState): ReplayResult {
  let position: Position;
  try {
    position = positionFromFen(game.initialFen, game.variant);
  } catch {
    return { ok: false, error: "invalid_initial_fen" };
  }
  const positionKeys: string[] = [positionKey(position)];

  for (const uci of game.moves) {
    const move = parseUci(uci);
    if (!move) return { ok: false, error: `unparseable_move:${uci}` };
    if (!position.isLegal(move)) {
      return { ok: false, error: `illegal_move_in_history:${uci}` };
    }
    position.play(move);
    positionKeys.push(positionKey(position));
  }

  return { ok: true, position, positionKeys };
}
