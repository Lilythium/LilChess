import type { ClockConfig, Color, GameState } from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

// In live games the clocks don't run until both sides have moved once.
// Until then each side only has this long to make its first move,
// otherwise the game is aborted (not lost on time).
export const FIRST_MOVE_WINDOW_MS = 30_000;

export function inFirstMoveWindow(game: GameState): boolean {
  return game.clock.mode === "live" && game.ply < 2;
}

// The deadline for the very first move of a freshly created game.
export function startingDeadline(clock: ClockConfig, now: number): number {
  if (clock.mode === "live") {
    return now + FIRST_MOVE_WINDOW_MS;
  }
  return now + (clock.daysPerMove ?? 1) * DAY_MS;
}

export interface ClockAfterMove {
  whiteMs: number;
  blackMs: number;
  deadlineAt: number; // deadline for the side about to move next
}

// Pure clock transition for one move. Assumes the caller has already
// confirmed now < game.deadlineAt (applyMove does this) — a flag fall
// is handled upstream, not by this function.
// `plyBefore` is game.ply before this move is applied.
export function advanceClock(
  clock: ClockConfig,
  mover: Color,
  whiteMs: number,
  blackMs: number,
  turnStartedAt: number,
  now: number,
  plyBefore: number,
): ClockAfterMove {
  if (clock.mode === "correspondence") {
    return {
      whiteMs,
      blackMs,
      deadlineAt: now + (clock.daysPerMove ?? 1) * DAY_MS,
    };
  }

  // Each side's first move is free: no time charged, no increment.
  // After white's move, black gets the first-move window; after black's
  // move the real clock starts, with white's full time.
  if (plyBefore < 2) {
    return {
      whiteMs,
      blackMs,
      deadlineAt: plyBefore === 0 ? now + FIRST_MOVE_WINDOW_MS : now + whiteMs,
    };
  }

  const elapsed = now - turnStartedAt;
  const increment = clock.incrementMs ?? 0;

  if (mover === "white") {
    const whiteRemaining = Math.max(0, whiteMs - elapsed);
    const blackRemaining = blackMs;
    return {
      whiteMs: whiteRemaining + increment,
      blackMs: blackRemaining,
      deadlineAt: now + whiteRemaining + increment,
    };
  }

  const blackRemaining = Math.max(0, blackMs - elapsed);
  const whiteRemaining = whiteMs;
  return {
    whiteMs: whiteRemaining,
    blackMs: blackRemaining + increment,
    deadlineAt: now + blackRemaining + increment,
  };
}

// Clock state after a takeback is accepted. Time is never refunded:
// the side currently on move is charged up to `now`, and the requester
// (who is to move after the takeback) restarts from `now`.
export function clockAfterTakeback(
  game: GameState,
  requester: Color,
  newPly: number,
  now: number,
): ClockAfterMove {
  const { clock } = game;
  if (clock.mode === "correspondence") {
    return {
      whiteMs: game.whiteMs,
      blackMs: game.blackMs,
      deadlineAt: now + (clock.daysPerMove ?? 1) * DAY_MS,
    };
  }
  if (newPly < 2) {
    return {
      whiteMs: game.whiteMs,
      blackMs: game.blackMs,
      deadlineAt: now + FIRST_MOVE_WINDOW_MS,
    };
  }
  let { whiteMs, blackMs } = game;
  const running = Math.max(0, game.deadlineAt - now); // stored ms of the mover is stale
  if (game.turn === "white") whiteMs = running;
  else blackMs = running;
  return {
    whiteMs,
    blackMs,
    deadlineAt: now + (requester === "white" ? whiteMs : blackMs),
  };
}