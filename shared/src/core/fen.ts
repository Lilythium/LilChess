import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { parseUci } from "chessops/util";

// FEN after replaying `moves` from `initialFen`, or null if anything is invalid.
export function fenAfterMoves(initialFen: string, moves: string[]): string | null {
  try {
    const pos = Chess.fromSetup(parseFen(initialFen).unwrap()).unwrap();
    for (const uci of moves) {
      const move = parseUci(uci);
      if (!move || !pos.isLegal(move)) return null;
      pos.play(move);
    }
    return makeFen(pos.toSetup());
  } catch {
    return null;
  }
}