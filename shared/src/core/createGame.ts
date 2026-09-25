import { startingDeadline } from "./clock.js";
import { START_FEN } from "./types.js";
import type { ClockConfig, GameState, Variant } from "./types.js";

export interface CreateGameOptions {
  clock: ClockConfig;
  variant?: Variant;
  initialFen?: string;
  now: number;
}

export function createGame(opts: CreateGameOptions): GameState {
  const startMs = opts.clock.mode === "live" ? opts.clock.initialMs ?? 0 : 0;
  return {
    variant: opts.variant ?? "standard",
    initialFen: opts.initialFen ?? START_FEN,
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