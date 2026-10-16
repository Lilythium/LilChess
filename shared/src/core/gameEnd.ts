import type { Position } from "chessops/chess";
import type { Color, GameResult, Termination } from "./types.js";

const REPETITION_THRESHOLD = 3;
const FIFTY_MOVE_HALFMOVES = 100; // 50 full moves by each side

export interface EndCheck {
  ended: boolean;
  result?: GameResult;
  termination?: Termination;
}

// `mover` is the color that just moved — position.turn has already
// flipped to whoever must move next by the time this is called.
// chessops' outcome() covers every variant's own ending (three checks, Antichess losing all pieces or
// being stalemated, Crazyhouse mate with no blocking drop) as well as plain mate, stalemate and
// insufficient material.
export function checkGameEnd(
  position: Position,
  mover: Color,
  positionKeys: string[],
): EndCheck {
  const outcome = position.outcome();
  if (outcome) {
    if (outcome.winner === undefined) {
      return {
        ended: true,
        result: "1/2-1/2",
        termination: position.isStalemate() ? "stalemate" : "insufficient_material",
      };
    }
    const result: GameResult = outcome.winner === "white" ? "1-0" : "0-1";
    if (position.isCheckmate()) return { ended: true, result, termination: "checkmate" };
    return {
      ended: true,
      result,
      termination: position.rules === "3check" ? "three_check" : "variant_end",
    };
  }
  if (position.halfmoves >= FIFTY_MOVE_HALFMOVES) {
    return { ended: true, result: "1/2-1/2", termination: "fifty_move" };
  }

  const currentKey = positionKeys[positionKeys.length - 1];
  const occurrences = positionKeys.filter((k) => k === currentKey).length;
  if (occurrences >= REPETITION_THRESHOLD) {
    return { ended: true, result: "1/2-1/2", termination: "repetition" };
  }

  return { ended: false };
}
