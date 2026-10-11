import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import { parseUci } from "chessops/util";
import type { Chess as ChessPosition } from "chessops/chess";

function positionFromFen(fen: string): ChessPosition | null {
  const setup = parseFen(fen);
  if (setup.isErr) return null;
  const pos = Chess.fromSetup(setup.value);
  return pos.isErr ? null : pos.value;
}

/** SAN for each move of a UCI line, stopping at the first illegal move. */
export function pvToSan(fen: string, pv: string[]): string[] {
  const pos = positionFromFen(fen);
  if (!pos) return [];
  const out: string[] = [];
  for (const uci of pv) {
    const move = parseUci(uci);
    if (!move || !pos.isLegal(move)) break;
    out.push(makeSan(pos, move));
    pos.play(move);
  }
  return out;
}

/** "12.Nf3 Nc6 13.d4", or "12...Nc6 13.d4" when Black is to move. */
export function formatPv(fen: string, pv: string[], maxPlies = 8): string {
  const sans = pvToSan(fen, pv.slice(0, maxPlies));
  const fields = fen.split(" ");
  let moveNo = Number(fields[5]) || 1;
  let white = fields[1] !== "b";
  const parts: string[] = [];
  sans.forEach((san, i) => {
    if (white) parts.push(`${moveNo}.${san}`);
    else parts.push(i === 0 ? `${moveNo}...${san}` : san);
    if (!white) moveNo++;
    white = !white;
  });
  return parts.join(" ");
}

/**
 * True when two UCI strings are the same move in this position. Compares the
 * resulting positions, so castling written as e1g1 or e1h1 counts as equal.
 */
export function sameMove(fen: string, a: string, b: string): boolean {
  if (a === b) return true;
  const pa = positionFromFen(fen);
  const pb = positionFromFen(fen);
  const ma = parseUci(a);
  const mb = parseUci(b);
  if (!pa || !pb || !ma || !mb || !pa.isLegal(ma) || !pb.isLegal(mb)) return false;
  pa.play(ma);
  pb.play(mb);
  return makeFen(pa.toSetup()) === makeFen(pb.toSetup());
}
