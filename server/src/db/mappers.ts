import type { ClockConfig, GameState } from "@lilchess/shared";

export function rowToGameState(row: any, moves: string[]): GameState {
  const clock: ClockConfig =
    row.mode === "live"
      ? { mode: "live", initialMs: row.initial_ms, incrementMs: row.increment_ms ?? 0 }
      : { mode: "correspondence", daysPerMove: row.days_per_move };

  return {
    variant: row.variant,
    initialFen: row.initial_fen,
    moves,
    ply: row.ply,
    turn: row.ply % 2 === 0 ? "white" : "black",
    clock,
    whiteMs: row.white_ms,
    blackMs: row.black_ms,
    turnStartedAt: row.turn_started_at,
    deadlineAt: row.deadline_at,
    status: row.status,
    result: row.result ?? undefined,
    termination: row.termination ?? undefined,
    drawOfferedBy: row.draw_offered_by ?? undefined,
  };
}

export function gameStateToRow(game: GameState) {
  return {
    variant: game.variant,
    mode: game.clock.mode,
    initialMs: game.clock.mode === "live" ? game.clock.initialMs ?? null : null,
    incrementMs: game.clock.mode === "live" ? game.clock.incrementMs ?? 0 : null,
    daysPerMove: game.clock.mode === "correspondence" ? game.clock.daysPerMove ?? null : null,
    status: game.status,
    result: game.result ?? null,
    termination: game.termination ?? null,
    initialFen: game.initialFen,
    ply: game.ply,
    whiteMs: game.whiteMs,
    blackMs: game.blackMs,
    turnStartedAt: game.turnStartedAt,
    deadlineAt: game.deadlineAt,
    drawOfferedBy: game.drawOfferedBy ?? null,
  };
}