import { sameMove, type Variant } from "@lilchess/shared";

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
