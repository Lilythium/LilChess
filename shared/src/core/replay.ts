import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { parseUci } from "chessops/util";
import type { GameState } from "./types.js";

export type ReplayResult =
  | { ok: true; position: Chess; positionKeys: string[] }
  | { ok: false; error: string };

// The repetition rule only cares about piece placement, side to move,
// castling rights, and en passant availability — not the halfmove or
// fullmove counters. Keep just the first four FEN fields as the key.
export function positionKey(pos: Chess): string {
  return makeFen(pos.toSetup()).split(" ").slice(0, 4).join(" ");
}

// Rebuilds the chessops position by replaying every move from
// initialFen. Pure: no I/O, never mutates the GameState it's given.
// Returns the position key after every ply (including ply 0, the
// starting position) so callers can check for repetition.
export function replay(game: GameState): ReplayResult {
  try {
    const setup = parseFen(game.initialFen).unwrap();
    const position = Chess.fromSetup(setup).unwrap();
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
  } catch {
    return { ok: false, error: "invalid_initial_fen" };
  }
}