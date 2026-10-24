import { makeSan } from "chessops/san";
import { parseUci } from "chessops/util";
import { expireGame } from "./actions.js";
import { advanceClock, inFirstMoveWindow } from "./clock.js";
import { checkGameEnd } from "./gameEnd.js";
import { keyFromFen, makeSeed, replay, SNAPSHOT_INTERVAL, type ReplayContext, type ReplaySeed } from "./replay.js";
import { fenOf } from "./position.js";
import { opponent } from "./types.js";
import type { ActionResult, GameState } from "./types.js";

// `snapshot` is set when this move lands on a checkpoint ply and the game goes on: the caller should store it.
type ApplyMoveResult = ActionResult & { san?: string; fen?: string; snapshot?: ReplaySeed };

export function applyMove(
  game: GameState,
  uci: string,
  now: number,
  seed?: ReplaySeed, // optional checkpoint at or before the current ply; saves replaying from the start
  context?: ReplayContext, // optional prepared in-memory position; the caller must pass a private copy
  onPositionKeys?: (positionKeys: string[]) => void, // receives bounded keys for the next move
): ApplyMoveResult {
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

  const replayed = context ? { ok: true as const, ...context } : replay(game, seed);

  if (!replayed.ok) {
    return { ok: false, error: replayed.error };
  }

  const { position, positionKeys } = replayed;

  if (!position.isLegal(move)) {
    return { ok: false, error: "illegal_move" };
  }

  const san = makeSan(position, move);
  const mover = game.turn;

  position.play(move);
  const fen = fenOf(position);
  positionKeys.push(keyFromFen(fen, position));
  // Only positions since the last pawn move or capture can matter for repetition.
  onPositionKeys?.(makeSeed(fen, position.halfmoves, game.moves.length + 1, positionKeys).keys);

  const clock = advanceClock(
    game.clock,
    mover,
    game.whiteMs,
    game.blackMs,
    game.turnStartedAt,
    now,
    game.ply,
  );

  const endCheck = checkGameEnd(position, mover, positionKeys);
  const newMoves = [...game.moves, uci];
  const snapshot =
    !endCheck.ended && newMoves.length % SNAPSHOT_INTERVAL === 0
      ? makeSeed(fen, position.halfmoves, newMoves.length, positionKeys)
      : undefined;

  return {
    ok: true,
    san,
    fen,
    snapshot,
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
