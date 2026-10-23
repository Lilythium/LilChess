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
import { recordOpeningGame } from "../../openings/stats.js";
import { notifyGameOver, notifyYourTurn } from "../../notifications/dispatch.js";
import { advanceTournamentSafely, flushTournamentEvents } from "../../tournaments/service.js";
import { flushSimulEvents, queueSimulBoard } from "../../simuls/events.js";
import { simulIdForGame } from "../../simuls/lookup.js";

export { insertGame } from "./insertGame.js";

function currentMoveRows(gameId: string): { uci: string; san: string }[] {
  return getDb().prepare(`
    SELECT m.uci, m.san
    FROM moves m
    JOIN games g ON g.id = m.game_id
    WHERE m.game_id = ? AND m.ply <= g.ply
      AND m.id = (
        SELECT MAX(previous.id) FROM moves previous
        WHERE previous.game_id = m.game_id AND previous.ply = m.ply
      )
    ORDER BY m.ply ASC
  `).all(gameId) as { uci: string; san: string }[];
}

function afterCommit(): void {
  notifyDeadlineChanged();
  flushTournamentEvents();
  flushSimulEvents();
}

export function getGame(id: string): GameState | undefined {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM games WHERE id = ?`).get(id) as any;
  if (!row) return undefined;
  return rowToGameState(row, currentMoveRows(id).map((move) => move.uci));
}

// Everything the analysis page needs and nothing else: two indexed reads, no replay,
// no SAN, no ratings, no head-to-head. The client rebuilds positions from these moves.
export function getGameForAnalysis(id: string) {
  const db = getDb();
  const game = db
    .prepare(
      `SELECT g.variant, g.initial_fen AS initialFen, g.status, g.result, g.termination,
              wu.username AS white, bu.username AS black
       FROM games g
       JOIN users wu ON wu.id = g.white_id
       JOIN users bu ON bu.id = g.black_id
       WHERE g.id = ?`,
    )
    .get(id) as
    | { variant: string; initialFen: string; status: string; result: string | null; termination: string | null; white: string; black: string }
    | undefined;
  if (!game) return undefined;
  const moves = currentMoveRows(id).map((move) => move.uci);
  return { ...game, moves };
}

export function getMoveSans(gameId: string): string[] {
  return currentMoveRows(gameId).map((move) => move.san);
}

export function getGameWithSans(id: string): { game: GameState; sans: string[] } | undefined {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM games WHERE id = ?`).get(id) as any;
  if (!row) return undefined;
  const moves = currentMoveRows(id);
  return { game: rowToGameState(row, moves.map((move) => move.uci)), sans: moves.map((move) => move.san) };
}

// Single choke point for writing game state: the stored position always matches the moves
function updateGameState(
  id: string,
  game: GameState,
  actorId: number | null = null,
  suppressTournamentForfeit = false,
): void {
  const row = gameStateToRow(game);
  const fen = fenAfterMoves(game.initialFen, game.moves, game.variant);
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

    queueSimulBoard(id);

  if (game.status !== "started") {
      advanceTournamentSafely(id, game.status === "aborted" && !suppressTournamentForfeit ? abortFaultId(id, game, actorId) : null);
  }
  if (game.status === "finished" && game.rated) settleRatings(id);
  if (game.status === "finished") recordOpeningGame(id);
}

function abortFaultId(gameId: string, game: GameState, actorId: number | null): number | null {
  if (actorId !== null) return actorId;
  const p = getParticipants(gameId);
  if (!p) return null;
  return game.turn === "white" ? p.whiteId : p.blackId;
}

function appendMove(gameId: string, ply: number, uci: string, san: string, playedAt: number): void {
  getDb()
    .prepare(`INSERT INTO moves (game_id, ply, uci, san, played_at) VALUES (?, ?, ?, ?, ?)`)
    .run(gameId, ply, uci, san, playedAt);
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
    .prepare(`
      SELECT g.id FROM games g
      WHERE g.status = 'started' AND g.deadline_at <= ?
        AND NOT (g.mode = 'live' AND g.ply < 2 AND EXISTS (
          SELECT 1 FROM tournament_pairings p JOIN tournaments t ON t.id = p.tournament_id
          WHERE p.game_id = g.id AND t.format = 'simul2'
        ))
      ORDER BY g.deadline_at ASC
    `)
    .all(now) as { id: string }[])
    .map((r) => r.id);
}

export function getEarliestActiveDeadline(): number | undefined {
  const row = getDb()
    .prepare(`
      SELECT MIN(g.deadline_at) AS deadline FROM games g
      WHERE g.status = 'started'
        AND NOT (g.mode = 'live' AND g.ply < 2 AND EXISTS (
          SELECT 1 FROM tournament_pairings p JOIN tournaments t ON t.id = p.tournament_id
          WHERE p.game_id = g.id AND t.format = 'simul2'
        ))
    `)
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

function isTournamentSimul2Game(gameId: string): boolean {
  return getDb().prepare(`
    SELECT 1 FROM tournament_pairings p JOIN tournaments t ON t.id = p.tournament_id
    WHERE p.game_id = ? AND t.format = 'simul2' LIMIT 1
  `).get(gameId) !== undefined;
}

function applyMoveCore(id: string, uci: string, now: number) {
  const before = getGame(id);
  if (!before) return { ok: false as const, error: "not_found" as const };

  const noOpeningAbort = before.clock.mode === "live" && before.ply < 2 && isTournamentSimul2Game(id);
  const gameForMove = noOpeningAbort ? { ...before, deadlineAt: Number.MAX_SAFE_INTEGER } : before;
  const result = applyMove(gameForMove, uci, now);
  if (!result.ok) return result;
  const state = noOpeningAbort && result.state.status === "started" && result.state.ply < 2
    ? { ...result.state, deadlineAt: Number.MAX_SAFE_INTEGER }
    : result.state;

  const movePlayed = state.moves.length > before.moves.length;
  let san: string | null = null;
  
  if (movePlayed && state.termination !== "timeout") {
    san = sanForNextMove(before, uci);
    if (!san) {
      throw new Error(`no SAN for ${uci} in game ${id} at ply ${before.ply}`);
    }
    // Never write a ply without its moves row. Throwing rolls back the surrounding transaction.
    appendMove(id, state.ply, uci, san, now);
    assertMoveRows(id, state.ply);
  }
  
  updateGameState(id, state);

  return { ...result, state, san, movePlayed };
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
  actorId: number | null = null,
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
  // Emails. A late move that only flags the mover is a timeout, so nobody "acted".
  if (movePlayed && san) notifyYourTurn(gameId, state, uci, san);
  notifyGameOver(gameId, state, movePlayed ? actorId : null);
}

export function applyMoveAndPersist(id: string, uci: string, now: number) {
  const outcome = getDb().transaction(() => applyMoveCore(id, uci, now)).immediate();
  if (outcome.ok && (outcome.movePlayed || outcome.state.status !== "started")) afterCommit();
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

  if (outcome.ok && (outcome.movePlayed || outcome.state.status !== "started")) afterCommit();
  if (outcome.ok) {
    broadcastMoveOutcome(gameId, uci, outcome.state, outcome.san, outcome.movePlayed, userId);
  }
  return outcome;
}

function actAndPersist(
  gameId: string,
  userId: number,
  action: (game: GameState, color: Color) => ActionResult,
  beforeWrite?: (state: GameState) => void, // runs inside the transaction
): ActionResult | NotFound | NotAParticipant {
  const result = getDb().transaction(() => {
    const p = getParticipants(gameId);
    if (!p) return { ok: false as const, error: "not_found" as const };
    const color = colorOf(userId, p);
    if (!color) return { ok: false as const, error: "not_a_participant" as const };

    const game = getGame(gameId);
    if (!game) return { ok: false as const, error: "not_found" as const };

    const result = action(game, color);
    if (result.ok) {
      beforeWrite?.(result.state);
      updateGameState(gameId, result.state, userId);
    }
    return result;
  }).immediate();
  if (result.ok) flushSimulEvents(); 
  if (result.ok && result.state.status !== "started") notifyDeadlineChanged();

  if (result.ok && result.state.status !== "started") notifyDeadlineChanged();
  return result;
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
    notifyGameOver(gameId, r.state, userId);
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
    notifyGameOver(gameId, r.state, userId);
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

export function terminateGameAsAdmin(gameId: string) {
  const outcome = getDb().transaction(() => {
    const game = getGame(gameId);
    if (!game) return { ok: false as const, error: "not_found" as const };
    if (game.status !== "started") return { ok: false as const, error: "game_not_active" as const };
    const state: GameState = {
      ...game,
      drawOfferedBy: undefined,
      takebackOfferedBy: undefined,
      status: "aborted",
      result: undefined,
      termination: "abort",
    };
    updateGameState(gameId, state, null, true);
    return { ok: true as const, state };
  }).immediate();

  if (outcome.ok) {
    afterCommit();
    broadcastGameOver(gameId, outcome.state);
    notifyGameOver(gameId, outcome.state, null);
  }
  return outcome;
}

export function offerTakebackAndPersist(gameId: string, userId: number) {
  const r = actAndPersist(gameId, userId, (game, color) =>
    simulIdForGame(gameId) ? { ok: false, error: "takebacks_disabled" } : offerTakeback(game, color));
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
    if (game.clock.mode === "live" && game.ply < 2 && isTournamentSimul2Game(gameId)) {
      return { ok: false as const, error: "not_yet_expired" as const };
    }
    const result = claimTimeout(game, now);
    if (result.ok) updateGameState(gameId, result.state);
    return result;
  }).immediate();

  if (outcome.ok) {
    notifyDeadlineChanged();
    broadcastGameOver(gameId, outcome.state);
    notifyGameOver(gameId, outcome.state, null);
    flushSimulEvents();
  }
  return outcome;
}

// games.ply and the active move line are written in one transaction. Retracted rows stay in history.
function assertMoveRows(gameId: string, ply: number): void {
  const row = getDb()
    .prepare(`SELECT COUNT(DISTINCT ply) AS n, COALESCE(MAX(ply), 0) AS top
              FROM moves WHERE game_id = ? AND ply <= ?`)
    .get(gameId, ply) as { n: number; top: number };
  if (row.n !== ply || row.top !== ply) {
    throw new Error(`game ${gameId}: ${row.n} move rows (max ply ${row.top}) but ply is ${ply}`);
  }
}