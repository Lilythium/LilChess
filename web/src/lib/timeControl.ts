import { LIVE_TC_LIMITS } from "@lilchess/shared";

export type CustomClock = { ok: true; initialMs: number; incrementMs: number } | { ok: false; error: string };

const MAX_MINUTES = Math.floor(LIVE_TC_LIMITS.maxInitialMs / 60_000);
const MAX_INCREMENT_S = LIVE_TC_LIMITS.maxIncrementMs / 1000;

/**
 * Turns what a player typed (minutes, increment in seconds) into the clock the server expects, using the same
 * limits the server enforces: any starting time from 10 seconds to just under 6 hours, increment up to 3 minutes.
 * Minutes may be fractional ("0.5" = 30 seconds).
 */
export function parseCustomClock(minutes: unknown, incrementSeconds: unknown): CustomClock {
  const min = Number(minutes);
  const inc = Number(incrementSeconds ?? 0);
  if (minutes === "" || minutes === null || !Number.isFinite(min)) return { ok: false, error: "Enter the starting time in minutes." };
  if (!Number.isFinite(inc) || !Number.isInteger(inc)) return { ok: false, error: "The increment must be a whole number of seconds." };

  const initialMs = Math.round(min * 60_000);
  if (initialMs < LIVE_TC_LIMITS.minInitialMs) return { ok: false, error: "The starting time must be at least 10 seconds (0.17 minutes)." };
  if (initialMs > LIVE_TC_LIMITS.maxInitialMs) return { ok: false, error: `The starting time must be under 6 hours (at most ${MAX_MINUTES} minutes).` };
  if (inc < 0 || inc > MAX_INCREMENT_S) return { ok: false, error: `The increment must be between 0 and ${MAX_INCREMENT_S} seconds.` };
  return { ok: true, initialMs, incrementMs: inc * 1000 };
}

/** "7 + 11", "0.5 + 0" for display next to a custom clock. */
export function describeCustomClock(minutes: number, incrementSeconds: number): string {
  return `${minutes} + ${incrementSeconds}`;
}
