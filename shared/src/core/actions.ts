import { clockAfterTakeback, inFirstMoveWindow } from "./clock.js";
import type { ActionResult, Color, GameState } from "./types.js";

const CLEARED_OFFERS = { drawOfferedBy: undefined, takebackOfferedBy: undefined } as const;

export function resign(game: GameState, by: Color): ActionResult {
  if (game.status !== "started") return { ok: false, error: "game_not_active" };
  return {
    ok: true,
    state: {
      ...game,
      ...CLEARED_OFFERS,
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
      ...CLEARED_OFFERS,
      status: "finished",
      result: "1/2-1/2",
      termination: "agreement",
    },
  };
}

export function declineDraw(game: GameState, by: Color): ActionResult {
  if (game.status !== "started") return { ok: false, error: "game_not_active" };
  if (game.drawOfferedBy === undefined) return { ok: false, error: "no_draw_to_decline" };
  if (game.drawOfferedBy === by) return { ok: false, error: "cannot_decline_own_offer" };
  return { ok: true, state: { ...game, drawOfferedBy: undefined } };
}

// Either side may abort — no `by` needed since the outcome (a void
// game, no result) is the same regardless of who requests it.
export function abort(game: GameState): ActionResult {
  if (game.status !== "started") return { ok: false, error: "game_not_active" };
  if (game.ply > 1) return { ok: false, error: "too_late_to_abort" };
  return { ok: true, state: { ...game, ...CLEARED_OFFERS, status: "aborted", termination: "abort" } };
}

// What happens when a deadline passes. Inside the first-move window of a
// live game nobody has lost on time: the game is simply aborted.
export function expireGame(game: GameState): GameState {
  if (inFirstMoveWindow(game)) {
    return { ...game, ...CLEARED_OFFERS, status: "aborted", termination: "abort" };
  }
  const loser = game.turn;
  return {
    ...game,
    ...CLEARED_OFFERS,
    status: "finished",
    result: loser === "white" ? "0-1" : "1-0",
    termination: "timeout",
    whiteMs: loser === "white" ? 0 : game.whiteMs,
    blackMs: loser === "black" ? 0 : game.blackMs,
  };
}

export function claimTimeout(game: GameState, now: number): ActionResult {
  if (game.status !== "started") return { ok: false, error: "game_not_active" };
  if (now < game.deadlineAt) return { ok: false, error: "not_yet_expired" };
  return { ok: true, state: expireGame(game) };
}

// ---- takebacks ----

// Ply index (1-based) of `by`'s most recent move, or 0 if they haven't moved.
function lastOwnPly(ply: number, by: Color): number {
  const own = by === "white" ? ply % 2 === 1 : ply % 2 === 0;
  const last = own ? ply : ply - 1;
  return last >= 1 ? last : 0;
}

export function canOfferTakeback(game: GameState, by: Color): boolean {
  return (
    game.status === "started" &&
    game.takebackOfferedBy === undefined &&
    lastOwnPly(game.ply, by) >= 1
  );
}

export function offerTakeback(game: GameState, by: Color): ActionResult {
  if (game.status !== "started") return { ok: false, error: "game_not_active" };
  if (game.takebackOfferedBy !== undefined) return { ok: false, error: "takeback_already_offered" };
  if (lastOwnPly(game.ply, by) < 1) return { ok: false, error: "nothing_to_take_back" };
  return { ok: true, state: { ...game, takebackOfferedBy: by } };
}

export function acceptTakeback(game: GameState, by: Color, now: number): ActionResult {
  if (game.status !== "started") return { ok: false, error: "game_not_active" };
  const requester = game.takebackOfferedBy;
  if (requester === undefined || requester === by) return { ok: false, error: "no_takeback_to_accept" };
  if (now >= game.deadlineAt) return { ok: false, error: "deadline_passed" }; // let the scheduler settle it

  const last = lastOwnPly(game.ply, requester);
  if (last < 1) return { ok: false, error: "nothing_to_take_back" };
  const newPly = last - 1; // the requester is to move again

  const clock = clockAfterTakeback(game, requester, newPly, now);
  return {
    ok: true,
    state: {
      ...game,
      moves: game.moves.slice(0, newPly),
      ply: newPly,
      turn: requester,
      whiteMs: clock.whiteMs,
      blackMs: clock.blackMs,
      turnStartedAt: now,
      deadlineAt: clock.deadlineAt,
      drawOfferedBy: undefined,
      takebackOfferedBy: undefined,
    },
  };
}

export function declineTakeback(game: GameState, by: Color): ActionResult {
  if (game.status !== "started") return { ok: false, error: "game_not_active" };
  if (game.takebackOfferedBy === undefined) return { ok: false, error: "no_takeback_to_decline" };
  if (game.takebackOfferedBy === by) return { ok: false, error: "cannot_decline_own_offer" };
  return { ok: true, state: { ...game, takebackOfferedBy: undefined } };
}