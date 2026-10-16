import type { Position } from "chessops/chess";
import { makeSquare } from "chessops/util";
import type { Role } from "chessops/types";
import type { Color, Variant } from "@lilchess/shared";

/** Pocket pieces in the order they are shown (a king can never be in a pocket). */
export const POCKET_ROLES: readonly Role[] = ["queen", "rook", "bishop", "knight", "pawn"];

const LETTER: Record<Role, string> = { pawn: "P", knight: "N", bishop: "B", rook: "R", queen: "Q", king: "K" };

export type PromotionRole = "q" | "r" | "b" | "n" | "k";

/** What a pawn may promote to. Antichess adds the king; every other variant is the usual four. */
export function promotionRoles(variant: Variant): PromotionRole[] {
  return variant === "antichess" ? ["q", "r", "b", "n", "k"] : ["q", "r", "b", "n"];
}

export const isDropVariant = (variant: Variant): boolean => variant === "crazyhouse";
export const hasStrips = (variant: Variant): boolean => variant === "crazyhouse" || variant === "threecheck";
/** Variants the Stockfish engine can evaluate (it only knows standard rules, plus Chess960). */
export const engineSupports = (variant: Variant): boolean => variant === "standard" || variant === "chess960";

/** UCI for dropping `role` on `square`, e.g. "N@f3". */
export function dropUci(role: Role, square: string): string {
  return `${LETTER[role]}@${square}`;
}

/** The pieces a side holds in reserve, in display order, with counts above zero. */
export function pocketOf(pos: Position, color: Color): { role: Role; count: number }[] {
  const pocket = pos.pockets?.[color];
  if (!pocket) return [];
  return POCKET_ROLES.flatMap((role) => {
    const count = pocket[role];
    return count > 0 ? [{ role, count }] : [];
  });
}

/** Squares `color` may legally drop `role` on right now (empty when it isn't their turn or they hold none). */
export function dropSquares(pos: Position, role: Role): string[] {
  if (!pos.pockets || pos.pockets[pos.turn][role] <= 0) return [];
  const out: string[] = [];
  for (let sq = 0; sq < 64; sq++) if (pos.isLegal({ role, to: sq })) out.push(makeSquare(sq));
  return out;
}

/** Three-check: how many more checks each side may still give before losing; null for other variants. */
export function checksLeft(pos: Position): { white: number; black: number } | null {
  return pos.remainingChecks ? { white: pos.remainingChecks.white, black: pos.remainingChecks.black } : null;
}
