import { fenAfterMoves, type GameState } from "@lilchess/shared";
import { getDb } from "../connection.js";
import { gameStateToRow } from "../mappers.js";

export function insertGame(id: string, whiteId: number, blackId: number, game: GameState): void {
  const row = gameStateToRow(game);
  const fen = fenAfterMoves(game.initialFen, game.moves) ?? game.initialFen;
  getDb()
    .prepare(
      `INSERT INTO games (
        id, white_id, black_id, variant, rated, mode,
        initial_ms, increment_ms, days_per_move,
        status, result, termination,
        initial_fen, fen, last_move, ply, white_ms, black_ms,
        turn_started_at, deadline_at, draw_offered_by, created_at
      ) VALUES (
        @id, @whiteId, @blackId, @variant, @rated, @mode,
        @initialMs, @incrementMs, @daysPerMove,
        @status, @result, @termination,
        @initialFen, @fen, @lastMove, @ply, @whiteMs, @blackMs,
        @turnStartedAt, @deadlineAt, @drawOfferedBy, @createdAt
      )`,
    )
    .run({ id, whiteId, blackId, ...row, fen, lastMove: game.moves.at(-1) ?? null, createdAt: Date.now() });
}