import { getDb } from "../connection.js";
import {
  applyMove,
  sanForNextMove,
  resign,
  offerDraw,
  acceptDraw,
  declineDraw,
  abort,
  claimTimeout,
  offerTakeback,
  acceptTakeback,
  declineTakeback,
  fenAfterMoves,
  type GameState,
  type Color,
  type ActionResult,
} from "@lilchess/shared";
import { gameStateToRow, rowToGameState } from "../mappers.js";
import { broadcastGameEvent } from "../../ws/hub.js";
import { sendWebhook } from "../../notifications/webhook.js";
import { notifyDeadlineChanged } from "../../game/deadlineBus.js";
import { settleRatings } from "./ratings.js";

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

export function getGame(id: string): GameState | undefined {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM games WHERE id = ?`).get(id) as any;
  if (!row) return undefined;
  const moves = db
    .prepare(`SELECT uci FROM moves WHERE game_id = ? ORDER BY ply ASC`)
    .all(id) as { uci: string }[];
  return rowToGameState(row, moves.map((m) => m.uci));
}

export function getMoveSans(gameId: string): string[] {
  return getDb()
    .prepare(`SELECT san FROM moves WHERE game_id = ? ORDER BY ply ASC`)
    .all(gameId)
    .map((r: any) => r.san);
}

export function getGameWithSans(id: string): { game: GameState; sans: string[] } | undefined {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM games WHERE id = ?`).get(id) as any;
  if (!row) return undefined;
  const moves = db
    .prepare(`SELECT uci, san FROM moves WHERE game_id = ? ORDER BY ply ASC`)
    .all(id) as { uci: string; san: string }[];
  return { game: rowToGameState(row, moves.map((m) => m.uci)), sans: moves.map((m) => m.san) };
}

// Single choke point for writing game state: the stored position always matches the moves
function updateGameState(id: string, game: GameState): void {
  const row = gameStateToRow(game);
  const fen = fenAfterMoves(game.initialFen, game.moves);
  if (fen === null) throw new Error(`game ${id}: moves do not replay from initial_fen`);
  getDb()
    .prepare(
      `UPDATE games SET
        status=@status, result=@result, termination=@termination,
        ply=@ply, fen=@fen, last_move=@lastMove,
        white_ms=@whiteMs, black_ms=@blackMs,
        turn_started_at=@turnStartedAt, deadline_at=@deadlineAt,
        draw_offered_by=@drawOfferedBy, takeback_offered_by=@takebackOfferedBy,
        ended_at = CASE WHEN @status = 'started' THEN NULL ELSE COALESCE(ended_at, @endedAt) END
      WHERE id=@id`,
    )
    .run({ id, ...row, fen, lastMove: game.moves.at(-1) ?? null, endedAt: Date.now() });

  if (game.status === "finished" && game.rated) settleRatings(id);
}

function appendMove(gameId: string, ply: number, uci: string, san: string): void {
  getDb()
    .prepare(`INSERT INTO moves (game_id, ply, uci, san) VALUES (?, ?, ?, ?)`)
    .run(gameId, ply, uci, san);
}

function deleteMovesAfter(gameId: string, ply: number): void {
  getDb().prepare(`DELETE FROM moves WHERE game_id = ? AND ply > ?`).run(gameId, ply);
}

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

export function getExpiredStartedGameIds(now: number): string[] {
  return (getDb()
    .prepare(`SELECT id FROM games WHERE status = 'started' AND deadline_at <= ? ORDER BY deadline_at ASC`)
    .all(now) as { id: string }[])
    .map((r) => r.id);
}

export function getEarliestActiveDeadline(): number | undefined {
  const row = getDb()
    .prepare(`SELECT MIN(deadline_at) AS deadline FROM games WHERE status = 'started'`)
    .get() as { deadline: number | null };
  return row.deadline ?? undefined;
}

type NotFound = { ok: false; error: "not_found" };
type NotAParticipant = { ok: false; error: "not_a_participant" };

export function getParticipants(id: string): { whiteId: number; blackId: number; ply: number } | undefined {
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

function applyMoveCore(id: string, uci: string, now: number) {
  const before = getGame(id);
  if (!before) return { ok: false as const, error: "not_found" as const };

  const result = applyMove(before, uci, now);
  if (!result.ok) return result;

  const movePlayed = result.state.moves.length > before.moves.length;
  let san: string | null = null;
  if (movePlayed) {
    san = sanForNextMove(before, uci);
    // Never write a ply without its moves row. Throwing rolls back the surrounding transaction.
    if (san === null) throw new Error(`no SAN for ${uci} in game ${id} at ply ${before.ply}`);
    appendMove(id, result.state.ply, uci, san);
    assertMoveRows(id, result.state.ply);
  }
  updateGameState(id, result.state);

  return { ...result, san, movePlayed };
}

function broadcastGameOver(gameId: string, state: GameState): void {
  if (state.status === "started") return;
  broadcastGameEvent(gameId, {
    type: "game_over",
    gameId,
    status: state.status,
    result: state.result,
    termination: state.termination,
  });
}

function broadcastMoveOutcome(
  gameId: string,
  uci: string,
  state: GameState,
  san: string | null,
  movePlayed: boolean,
): void {
  if (movePlayed && san) {
    broadcastGameEvent(gameId, {
      type: "move",
      gameId,
      ply: state.ply,
      uci,
      san,
      turn: state.turn,
      whiteMs: state.whiteMs,
      blackMs: state.blackMs,
      deadlineAt: state.deadlineAt,
    });
  }
  broadcastGameOver(gameId, state);
  if (movePlayed && san && state.clock.mode === "correspondence") {
    void sendWebhook(`Move played in game ${gameId}: ${san}. Now ${state.turn} to move.`);
  }
  if (state.status === "finished" && state.clock.mode === "correspondence") {
    void sendWebhook(`Game ${gameId} ended: ${state.result ?? "—"} (${state.termination}).`);
  }
  if (movePlayed) notifyDeadlineChanged();
}

export function applyMoveAndPersist(id: string, uci: string, now: number) {
  const outcome = getDb().transaction(() => applyMoveCore(id, uci, now)).immediate();
  if (outcome.ok) broadcastMoveOutcome(id, uci, outcome.state, outcome.san, outcome.movePlayed);
  return outcome;
}

export function submitMove(
  gameId: string,
  userId: number,
  submittedPly: number,
  uci: string,
): ActionResult | { ok: false; error: "not_found" | "ply_mismatch" | "not_your_turn" } {
  const outcome = getDb().transaction(() => {
    const p = getParticipants(gameId);
    if (!p) return { ok: false as const, error: "not_found" as const };
    if (p.ply !== submittedPly) return { ok: false as const, error: "ply_mismatch" as const };
    const turn: Color = p.ply % 2 === 0 ? "white" : "black";
    if ((turn === "white" ? p.whiteId : p.blackId) !== userId) {
      return { ok: false as const, error: "not_your_turn" as const };
    }
    return applyMoveCore(gameId, uci, Date.now());
  }).immediate();

  if (outcome.ok) {
    broadcastMoveOutcome(gameId, uci, outcome.state, outcome.san, outcome.movePlayed);
  }
  return outcome;
}

function actAndPersist(
  gameId: string,
  userId: number,
  action: (game: GameState, color: Color) => ActionResult,
  beforeWrite?: (state: GameState) => void, // runs inside the transaction
): ActionResult | NotFound | NotAParticipant {
  return getDb().transaction(() => {
    const p = getParticipants(gameId);
    if (!p) return { ok: false as const, error: "not_found" as const };
    const color = colorOf(userId, p);
    if (!color) return { ok: false as const, error: "not_a_participant" as const };

    const game = getGame(gameId);
    if (!game) return { ok: false as const, error: "not_found" as const };

    const result = action(game, color);
    if (result.ok) {
      beforeWrite?.(result.state);
      updateGameState(gameId, result.state);
    }
    return result;
  }).immediate();
}

export function resignAndPersist(gameId: string, userId: number) {
  const r = actAndPersist(gameId, userId, resign);
  if (r.ok) {
    broadcastGameEvent(gameId, {
      type: "game_over",
      gameId,
      status: "finished",
      result: r.state.result,
      termination: r.state.termination,
    });
  }
  return r;
}

export function offerDrawAndPersist(gameId: string, userId: number) {
  const r = actAndPersist(gameId, userId, offerDraw);
  if (r.ok) {
    broadcastGameEvent(gameId, { type: "draw_offer", gameId, by: r.state.drawOfferedBy ?? null });
  }
  return r;
}

export function acceptDrawAndPersist(gameId: string, userId: number) {
  const r = actAndPersist(gameId, userId, acceptDraw);
  if (r.ok) {
    broadcastGameEvent(gameId, {
      type: "game_over",
      gameId,
      status: "finished",
      result: r.state.result,
      termination: r.state.termination,
    });
  }
  return r;
}

export function declineDrawAndPersist(gameId: string, userId: number) {
  const r = actAndPersist(gameId, userId, declineDraw);
  if (r.ok) {
    broadcastGameEvent(gameId, { type: "draw_offer", gameId, by: null });
  }
  return r;
}

export function abortAndPersist(gameId: string, userId: number) {
  const r = actAndPersist(gameId, userId, (game) => abort(game));
  if (r.ok) {
    broadcastGameEvent(gameId, {
      type: "game_over",
      gameId,
      status: "aborted",
      termination: r.state.termination,
    });
  }
  return r;
}

export function offerTakebackAndPersist(gameId: string, userId: number) {
  const r = actAndPersist(gameId, userId, offerTakeback);
  if (r.ok) {
    broadcastGameEvent(gameId, { type: "takeback_offer", gameId, by: r.state.takebackOfferedBy ?? null });
  }
  return r;
}

export function acceptTakebackAndPersist(gameId: string, userId: number) {
  const r = actAndPersist(
    gameId,
    userId,
    (game, color) => acceptTakeback(game, color, Date.now()),
    (state) => {
      deleteMovesAfter(gameId, state.ply);
      assertMoveRows(gameId, state.ply);
    },
  );
  if (r.ok) {
    broadcastGameEvent(gameId, {
      type: "takeback",
      gameId,
      ply: r.state.ply,
      turn: r.state.turn,
      whiteMs: r.state.whiteMs,
      blackMs: r.state.blackMs,
      deadlineAt: r.state.deadlineAt,
    });
    notifyDeadlineChanged();
  }
  return r;
}

export function declineTakebackAndPersist(gameId: string, userId: number) {
  const r = actAndPersist(gameId, userId, declineTakeback);
  if (r.ok) {
    broadcastGameEvent(gameId, { type: "takeback_offer", gameId, by: null });
  }
  return r;
}

export function claimTimeoutAndPersist(gameId: string, now: number) {
  const outcome = getDb().transaction(() => {
    const game = getGame(gameId);
    if (!game) return { ok: false as const, error: "not_found" as const };
    const result = claimTimeout(game, now);
    if (result.ok) updateGameState(gameId, result.state);
    return result;
  }).immediate();

  if (outcome.ok) broadcastGameOver(gameId, outcome.state);
  return outcome;
}

// games.ply and the moves table are written in one transaction. If a bug ever breaks that,
// fail (and roll back) loudly instead of storing a game whose rows disagree with its ply.
function assertMoveRows(gameId: string, ply: number): void {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS n, COALESCE(MAX(ply), 0) AS top FROM moves WHERE game_id = ?`)
    .get(gameId) as { n: number; top: number };
  if (row.n !== ply || row.top !== ply) {
    throw new Error(`game ${gameId}: ${row.n} move rows (max ply ${row.top}) but ply is ${ply}`);
  }
}