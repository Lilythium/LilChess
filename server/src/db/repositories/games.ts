import { applyMove, sanForNextMove, type GameState } from "@lilchess/shared";
import { getDb } from "../connection.js";
import {
  applyMove,
  sanForNextMove,
  resign,
  offerDraw,
  acceptDraw,
  declineDraw,
  abort,
  type GameState,
  type Color,
  type ActionResult,
} from "@lilchess/shared";
import { getDb } from "../connection.js";
import { gameStateToRow, rowToGameState } from "../mappers.js";

export function insertGame(id: string, whiteId: number, blackId: number, game: GameState): void {
  const row = gameStateToRow(game);
  getDb()
    .prepare(
      `INSERT INTO games (
        id, white_id, black_id, variant, mode,
        initial_ms, increment_ms, days_per_move,
        status, result, termination,
        initial_fen, ply, white_ms, black_ms,
        turn_started_at, deadline_at, draw_offered_by, created_at
      ) VALUES (
        @id, @whiteId, @blackId, @variant, @mode,
        @initialMs, @incrementMs, @daysPerMove,
        @status, @result, @termination,
        @initialFen, @ply, @whiteMs, @blackMs,
        @turnStartedAt, @deadlineAt, @drawOfferedBy, @createdAt
      )`,
    )
    .run({ id, whiteId, blackId, ...row, createdAt: Date.now() });
}

export function getGame(id: string): GameState | undefined {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM games WHERE id = ?`).get(id) as any;
  if (!row) return undefined;
  const moves = db
    .prepare(`SELECT uci FROM moves WHERE game_id = ? ORDER BY ply ASC`)
    .all(id) as { uci: string }[];
  return rowToGameState(row, moves.map((m) => m.uci));
}

function updateGameState(id: string, game: GameState): void {
  const row = gameStateToRow(game);
  const endedAt = game.status === "started" ? null : Date.now();
  getDb()
    .prepare(
      `UPDATE games SET
        status=@status, result=@result, termination=@termination,
        ply=@ply, white_ms=@whiteMs, black_ms=@blackMs,
        turn_started_at=@turnStartedAt, deadline_at=@deadlineAt,
        draw_offered_by=@drawOfferedBy, ended_at=@endedAt
      WHERE id=@id`,
    )
    .run({ id, ...row, endedAt });
}

function appendMove(gameId: string, ply: number, uci: string, san: string): void {
  getDb()
    .prepare(`INSERT INTO moves (game_id, ply, uci, san) VALUES (?, ?, ?, ?)`)
    .run(gameId, ply, uci, san);
}

export function applyMoveAndPersist(id: string, uci: string, now: number) {
  const before = getGame(id);
  if (!before) return { ok: false as const, error: "not_found" };

  const san = sanForNextMove(before, uci);
  const result = applyMove(before, uci, now);
  if (!result.ok) return result;

  const movePlayed = result.state.moves.length > before.moves.length;
  const tx = getDb().transaction(() => {
    if (movePlayed && san) appendMove(id, result.state.ply, uci, san);
    updateGameState(id, result.state);
  });
  tx();

  return result;
}

// Straight from the roadmap sketch, just bound as named params.
export function headToHead(meId: number, themId: number) {
  return getDb()
    .prepare(
      `SELECT
        SUM(result = '1-0' AND white_id = :me OR result = '0-1' AND black_id = :me) AS wins,
        SUM(result = '1/2-1/2') AS draws,
        SUM(result = '1-0' AND white_id = :them OR result = '0-1' AND black_id = :them) AS losses
      FROM games
      WHERE status = 'finished'
        AND ((white_id = :me AND black_id = :them) OR (white_id = :them AND black_id = :me))`,
    )
    .get({ me: meId, them: themId });
}

type NotFound = { ok: false; error: "not_found" };
type NotAParticipant = { ok: false; error: "not_a_participant" };

function getParticipants(id: string): { whiteId: number; blackId: number; ply: number } | undefined {
  const row = getDb()
    .prepare(`SELECT white_id, black_id, ply FROM games WHERE id = ?`)
    .get(id) as { white_id: number; black_id: number; ply: number } | undefined;
  if (!row) return undefined;
  return { whiteId: row.white_id, blackId: row.black_id, ply: row.ply };
}

function colorOf(userId: number, p: { whiteId: number; blackId: number }): Color | undefined {
  if (p.whiteId === userId) return "white";
  if (p.blackId === userId) return "black";
  return undefined;
}

// Ply-idempotent, turn-checked move submission. This is the function the
// route calls — it wraps applyMoveAndPersist with the guards that used
// to live (incorrectly) in moveTx.ts.
export function submitMove(
  gameId: string,
  userId: number,
  submittedPly: number,
  uci: string,
): ActionResult | NotFound | { ok: false; error: "ply_mismatch" | "not_your_turn" } {
  const p = getParticipants(gameId);
  if (!p) return { ok: false, error: "not_found" };
  if (p.ply !== submittedPly) return { ok: false, error: "ply_mismatch" };

  const turn: Color = p.ply % 2 === 0 ? "white" : "black";
  const expectedUserId = turn === "white" ? p.whiteId : p.blackId;
  if (expectedUserId !== userId) return { ok: false, error: "not_your_turn" };

  return applyMoveAndPersist(gameId, uci, Date.now());
}

function actAndPersist(
  gameId: string,
  userId: number,
  action: (game: GameState, color: Color) => ActionResult,
): ActionResult | NotFound | NotAParticipant {
  const p = getParticipants(gameId);
  if (!p) return { ok: false, error: "not_found" };
  const color = colorOf(userId, p);
  if (!color) return { ok: false, error: "not_a_participant" };

  const game = getGame(gameId);
  if (!game) return { ok: false, error: "not_found" };

  const result = action(game, color);
  if (result.ok) updateGameState(gameId, result.state);
  return result;
}

export function resignAndPersist(gameId: string, userId: number) {
  return actAndPersist(gameId, userId, resign);
}

export function offerDrawAndPersist(gameId: string, userId: number) {
  return actAndPersist(gameId, userId, offerDraw);
}

export function acceptDrawAndPersist(gameId: string, userId: number) {
  return actAndPersist(gameId, userId, acceptDraw);
}

export function declineDrawAndPersist(gameId: string, userId: number) {
  return actAndPersist(gameId, userId, declineDraw);
}

export function abortAndPersist(gameId: string, userId: number) {
  return actAndPersist(gameId, userId, (game) => abort(game));
}