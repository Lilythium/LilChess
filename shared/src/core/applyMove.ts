import { parseUci } from "chessops/util";
import { expireGame } from "./actions.js";
import { advanceClock, inFirstMoveWindow } from "./clock.js";import { checkGameEnd } from "./gameEnd.js";import { positionKey, replay } from "./replay.js";
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

  if (!inFirstMoveWindow(game) && now >= game.deadlineAt) {
    return { ok: true, state: expireGame(game) };
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
    game.ply,
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
      takebackOfferedBy: undefined,
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
