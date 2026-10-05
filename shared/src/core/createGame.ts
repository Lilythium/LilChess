import { startingDeadline } from "./clock.js";
import type { ClockConfig, GameState, Variant } from "./types.js";
import { startFenFor } from "./variants.js";

export interface CreateGameOptions {
  clock: ClockConfig;
  variant?: Variant;
  initialFen?: string;
  rated?: boolean;
  now: number;
}

export function createGame(opts: CreateGameOptions): GameState {
  const variant = opts.variant ?? "standard";
  const startMs = opts.clock.mode === "live" ? opts.clock.initialMs ?? 0 : 0;
  return {
    variant,
    initialFen: opts.initialFen ?? startFenFor(variant),
    rated: opts.rated ?? false,
    moves: [],
    ply: 0,
    turn: "white",
    clock: opts.clock,
    whiteMs: startMs,
    blackMs: startMs,
    turnStartedAt: opts.now,
    deadlineAt: startingDeadline(opts.clock, opts.now),
    status: "started",
  };
}