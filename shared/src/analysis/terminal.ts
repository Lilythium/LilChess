import { Chess } from "chessops/chess";
import { parseFen } from "chessops/fen";
import type { Score } from "./score.js";

/**
 * The score of a position that needs no engine: checkmate, stalemate or
 * insufficient material. Returns null while the game can still go on.
 */
export function terminalScore(fen: string): Score | null {
  const setup = parseFen(fen);
  if (setup.isErr) return null;
  const pos = Chess.fromSetup(setup.value);
  if (pos.isErr) return null;
  const p = pos.value;
  if (p.isCheckmate()) return { kind: "checkmate", winner: p.turn === "white" ? "black" : "white" };
  if (p.isEnd()) return { kind: "cp", cp: 0 };
  return null;
}
