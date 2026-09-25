import type { ActionResult, Color, GameState } from "./types.js";

export function resign(game: GameState, by: Color): ActionResult {
  if (game.status !== "started") return { ok: false, error: "game_not_active" };
  return {
    ok: true,
    state: {
      ...game,
      status: "finished",
      result: by === "white" ? "0-1" : "1-0",
      termination: "resignation",
    },
  };
}

export function offerDraw(game: GameState, by: Color): ActionResult {
  if (game.status !== "started") return { ok: false, error: "game_not_active" };
  return { ok: true, state: { ...game, drawOfferedBy: by } };
}

export function acceptDraw(game: GameState, by: Color): ActionResult {
  if (game.status !== "started") return { ok: false, error: "game_not_active" };
  if (game.drawOfferedBy === undefined || game.drawOfferedBy === by) {
    return { ok: false, error: "no_draw_to_accept" };
  }
  return {
    ok: true,
    state: {
      ...game,
      status: "finished",
      result: "1/2-1/2",
      termination: "agreement",
      drawOfferedBy: undefined,
    },
  };
}

// Either side may abort — no `by` needed since the outcome (a void
// game, no result) is the same regardless of who requests it.
export function abort(game: GameState): ActionResult {
  if (game.status !== "started") return { ok: false, error: "game_not_active" };
  if (game.ply > 1) return { ok: false, error: "too_late_to_abort" }; // black has already replied
  return { ok: true, state: { ...game, status: "aborted", termination: "abort" } };
}

export function claimTimeout(game: GameState, now: number): ActionResult {
  if (game.status !== "started") return { ok: false, error: "game_not_active" };
  if (now < game.deadlineAt) return { ok: false, error: "not_yet_expired" };
  return {
    ok: true,
    state: {
      ...game,
      status: "finished",
      result: game.turn === "white" ? "0-1" : "1-0",
      termination: "timeout",
    },
  };
}