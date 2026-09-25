import type { Chess } from "chessops/chess";
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
export function checkGameEnd(
  position: Chess,
  mover: Color,
  positionKeys: string[],
): EndCheck {
  if (position.isCheckmate()) {
    return {
      ended: true,
      result: mover === "white" ? "1-0" : "0-1",
      termination: "checkmate",
    };
  }
  if (position.isStalemate()) {
    return { ended: true, result: "1/2-1/2", termination: "stalemate" };
  }
  if (position.isInsufficientMaterial()) {
    return {
      ended: true,
      result: "1/2-1/2",
      termination: "insufficient_material",
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