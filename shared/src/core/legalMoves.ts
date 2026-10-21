import type { Role } from "chessops/types";
import { makeUci, squareRank } from "chessops/util";
import { positionFromFen } from "./position.js";
import type { Variant } from "./types.js";

export interface LegalMove {
  uci: string;
  capture: boolean;
  checkmate: boolean;
}

const PROMOTIONS: Role[] = ["queen", "rook", "bishop", "knight"];

/**
 * Every legal board move in `fen`, in UCI. Drops (Crazyhouse) are not included, so this is for the variants
 * that only move pieces. Used by the demo server's practice bot; it never decides who wins or whose turn it is.
 */
export function legalMoves(fen: string, variant: Variant = "standard"): LegalMove[] {
  const pos = positionFromFen(fen, variant);
  const out: LegalMove[] = [];
  for (const [from, dests] of pos.allDests()) {
    const piece = pos.board.get(from);
    for (const to of dests) {
      const lastRank = squareRank(to) === 0 || squareRank(to) === 7;
      const promotes = piece?.role === "pawn" && lastRank;
      const enPassant = piece?.role === "pawn" && pos.epSquare === to;
      const capture = pos.board.has(to) || enPassant;
      for (const promotion of promotes ? PROMOTIONS : [undefined]) {
        const move = { from, to, promotion };
        const after = pos.clone();
        after.play(move);
        out.push({ uci: makeUci(move), capture, checkmate: after.isCheckmate() });
      }
    }
  }
  return out;
}
