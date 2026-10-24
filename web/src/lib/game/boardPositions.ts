import type { Position } from "chessops/chess";
import { PositionTimeline, positionFromFen, type GameState } from "@lilchess/shared";

type PlayedGame = Pick<GameState, "initialFen" | "variant" | "moves">;

/**
 * The positions the live board needs, kept up to date one move at a time.
 *
 * Replaying a game from move 1 on every render costs time proportional to the game's length, on the thread that
 * also animates the board. This keeps every position of the game it was last asked about: a new move replays only
 * that move, a takeback just drops the tail, and stepping through history is a lookup plus one FEN parse.
 * (A Web Worker can't do this job: it needs a chessops Position per move, which can't cross threads, and the work is
 * far smaller than a round trip. Whole-game work that does fit a worker lives in lib/chess.)
 */
export function createBoardPositions() {
  let timeline: PositionTimeline | null = null;

  return {
    /**
     * The position after `ply` plies of `game`, or null if the start position is invalid or the recorded moves can't
     * be played that far. Always returns a fresh Position the caller may mutate.
     */
    at(game: PlayedGame, ply: number): Position | null {
      try {
        if (!timeline || timeline.initialFen !== game.initialFen || timeline.variant !== game.variant) {
          timeline = new PositionTimeline(game.initialFen, game.variant);
        }
        timeline.sync(game.moves); // replays only what changed since the last call
        const fen = timeline.fens[ply];
        return fen === undefined ? null : positionFromFen(fen, game.variant);
      } catch {
        timeline = null;
        return null;
      }
    },
  };
}
