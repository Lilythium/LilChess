import { Chess, type Position } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import type { Rules } from "chessops/types";
import { defaultPosition, setupPosition } from "chessops/variant";
import type { Variant } from "./types.js";

/** The chessops rule set each LilChess variant plays by. Chess960 is plain chess with a shuffled start. */
export function rulesFor(variant: Variant): Rules {
  switch (variant) {
    case "crazyhouse":
      return "crazyhouse";
    case "threecheck":
      return "3check";
    case "antichess":
      return "antichess";
    default:
      return "chess";
  }
}

/** Builds the position for `fen` under the variant's rules. Throws "invalid_initial_fen" if it can't. */
export function positionFromFen(fen: string, variant: Variant = "standard"): Position {
  const setup = parseFen(fen);
  if (setup.isErr) throw new Error("invalid_initial_fen");
  const pos = variant === "standard" || variant === "chess960" ? Chess.fromSetup(setup.value) : setupPosition(rulesFor(variant), setup.value);
  if (pos.isErr) throw new Error("invalid_initial_fen");
  return pos.value;
}

export function fenOf(pos: Position): string {
  return makeFen(pos.toSetup());
}

/** Start position for a variant that doesn't randomise (everything except Chess960). */
export function fixedStartFen(variant: Variant): string {
  return fenOf(defaultPosition(rulesFor(variant)));
}
