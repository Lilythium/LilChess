import type { ClockConfig, Color } from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

// The deadline for the very first move of a freshly created game.
export function startingDeadline(clock: ClockConfig, now: number): number {
  if (clock.mode === "live") {
    return now + (clock.initialMs ?? 0);
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
export function advanceClock(
  clock: ClockConfig,
  mover: Color,
  whiteMs: number,
  blackMs: number,
  turnStartedAt: number,
  now: number,
): ClockAfterMove {
  if (clock.mode === "correspondence") {
    return {
      whiteMs,
      blackMs,
      deadlineAt: now + (clock.daysPerMove ?? 1) * DAY_MS,
    };
  }

  const elapsed = now - turnStartedAt;
  const moverRemaining = (mover === "white" ? whiteMs : blackMs) - elapsed;
  const increment = clock.incrementMs ?? 0;
  const moverNewMs = moverRemaining + increment;

  const newWhiteMs = mover === "white" ? moverNewMs : whiteMs;
  const newBlackMs = mover === "black" ? moverNewMs : blackMs;
  const opponentRemaining = mover === "white" ? newBlackMs : newWhiteMs;

  return {
    whiteMs: newWhiteMs,
    blackMs: newBlackMs,
    deadlineAt: now + opponentRemaining,
  };
}