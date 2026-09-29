import { parseUci } from "chessops/util";
import { advanceClock } from "./clock.js";
import { checkGameEnd } from "./gameEnd.js";
import { positionKey, replay } from "./replay.js";
import { opponent } from "./types.js";
import type { ActionResult, GameState } from "./types.js";

export function applyMove(
  game: GameState,
  uci: string,
  now: number,
): ActionResult {
  if (game.status !== "started") {
    return { ok: false, error: "game_not_active" };
  }

  if (now >= game.deadlineAt) {
  const loser = game.turn;
  return {
    ok: true,
    state: {
      ...game,
      status: "finished",
      result: loser === "white" ? "0-1" : "1-0",
      termination: "timeout",
      whiteMs: loser === "white" ? 0 : game.whiteMs,
      blackMs: loser === "black" ? 0 : game.blackMs,
    },
  };
}

  const move = parseUci(uci);
  if (!move) {
    return { ok: false, error: "unparseable_move" };
  }

  const replayed = replay(game);
  if (!replayed.ok) {
    return { ok: false, error: replayed.error };
  }
  const { position, positionKeys } = replayed;

  if (!position.isLegal(move)) {
    return { ok: false, error: "illegal_move" };
  }

  const mover = game.turn;
  position.play(move);

  const clock = advanceClock(
    game.clock,
    mover,
    game.whiteMs,
    game.blackMs,
    game.turnStartedAt,
    now,
  );

  const allKeys = [...positionKeys, positionKey(position)];
  const endCheck = checkGameEnd(position, mover, allKeys);
  const newMoves = [...game.moves, uci];

  return {
    ok: true,
    state: {
      ...game,
      moves: newMoves,
      ply: newMoves.length,
      turn: opponent(mover),
      whiteMs: clock.whiteMs,
      blackMs: clock.blackMs,
      turnStartedAt: now,
      deadlineAt: clock.deadlineAt,
      drawOfferedBy: undefined,
      ...(endCheck.ended
        ? {
            status: "finished" as const,
            result: endCheck.result,
            termination: endCheck.termination,
          }
        : {}),
    },
  };
}