import { makeSan } from "chessops/san";
import { parseUci } from "chessops/util";
import { positionFromFen, sameMove, type Variant } from "@lilchess/shared";

/** How many leading plies two move lists share. */
export function commonPrefix(a: string[], b: string[]): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/**
 * The line after the user plays `uci` from the position after `atPly` plies.
 * Replaying the move that is already next in the line just returns the same line
 * (the user steps forward); anything else cuts the line there and starts a sideline.
 */
export function playOnLine(line: string[], atPly: number, uci: string, fenAtPly: string, variant: Variant = "standard"): string[] {
  const existing = line[atPly];
  if (existing !== undefined && sameMove(fenAtPly, existing, uci, variant)) return line;
  return [...line.slice(0, atPly), uci];
}

/** SAN of `uci` played from `fen`, or null if it is not legal there. One position, however long the line is. */
export function sanAfter(fen: string, uci: string, variant: Variant = "standard"): string | null {
  try {
    const pos = positionFromFen(fen, variant);
    const move = parseUci(uci);
    return move && pos.isLegal(move) ? makeSan(pos, move) : null;
  } catch {
    return null;
  }
}
