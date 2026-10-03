import type { Color, GameState } from "@lilchess/shared";

export function getLowTimeThreshold(startingTime: number): number {
  if (startingTime < 60_000) {
    return startingTime / 2;
  }

  if (startingTime < 120_000) {
    return 30_000;
  }

  if (startingTime <= 300_000) {
    return 60_000;
  }

  return startingTime / 10;
}

export function crossedLowTimeThreshold(
  startingTime: number,
  previousMs: number,
  currentMs: number,
): boolean {
  const threshold = getLowTimeThreshold(startingTime);

  return previousMs > threshold && currentMs <= threshold;
}

// The stored ms of the side to move is stale (as of turnStartedAt),
// so derive it from the deadline. The waiting side's stored value is exact.
export function remainingMs(
  g: GameState,
  side: Color,
  serverNow: number,
): number {
  if (g.termination === "timeout" && g.turn === side) return 0;

  if (
    g.status === "started" &&
    g.clock.mode === "live" &&
    g.ply >= 2 &&
    g.turn === side
  ) {
    return Math.max(0, g.deadlineAt - serverNow);
  }

  return side === "white" ? g.whiteMs : g.blackMs;
}

export function formatClock(ms: number): string {
  if (ms < 10_000) return `0:${(ms / 1000).toFixed(1).padStart(4, "0")}`;
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60);
  return m >= 60
    ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`
    : `${m}:${String(s % 60).padStart(2, "0")}`;
}