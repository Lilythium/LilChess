import { getDb } from "../connection.js";
import {
  getCachedActiveGame,
  getCachedActiveGameParticipants,
  getCachedFenForMoves,
  refreshActiveGameAfterWrite,
  rememberActiveGame,
} from "../../game/activeGameCache.js";
import {
  applyMove,
  fenOf,
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
  positionFromFen,
  replay,
  SNAPSHOT_INTERVAL,
  type ReplaySeed,
  type ReplayContext,
  type GameState,
  type GameEvent,
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

function currentMoveUcis(gameId: string): string[] {
  return getDb().prepare(`
    SELECT m.uci FROM active_moves a
    JOIN moves m ON m.id = a.move_id
    WHERE a.game_id = ?
    ORDER BY a.ply ASC
  `).pluck().all(gameId) as string[];
}

function currentMoveSans(gameId: string): string[] {
  return getDb().prepare(`
    SELECT m.san FROM active_moves a
    JOIN moves m ON m.id = a.move_id
    WHERE a.game_id = ?
    ORDER BY a.ply ASC
  `).pluck().all(gameId) as string[];
}

function currentMoveRows(gameId: string): { uci: string; san: string }[] {
  return getDb().prepare(`
    SELECT m.uci, m.san FROM active_moves a
    JOIN moves m ON m.id = a.move_id
    WHERE a.game_id = ?
    ORDER BY a.ply ASC
  `).all(gameId) as { uci: string; san: string }[];
}

// Nearest valid checkpoint at or before `ply`. The join to active_moves drops checkpoints whose move
// has been retracted, so a stale row can never seed a replay.
function loadSeed(gameId: string, ply: number): ReplaySeed | undefined {
  if (ply < SNAPSHOT_INTERVAL) return undefined;
  const row = getDb()
    .prepare(
      `SELECT s.ply, s.fen, s.keys FROM game_snapshots s
       JOIN active_moves a ON a.game_id = s.game_id AND a.ply = s.ply AND a.move_id = s.move_id
       WHERE s.game_id = ? AND s.ply <= ?
       ORDER BY s.ply DESC LIMIT 1`,
    )
    .get(gameId, ply) as { ply: number; fen: string; keys: string } | undefined;
  return row ? { ply: row.ply, fen: row.fen, keys: row.keys.split("\n") } : undefined;
}

function saveSnapshot(gameId: string, moveId: number, seed: ReplaySeed): void {
  getDb()
    .prepare(`INSERT OR REPLACE INTO game_snapshots (game_id, ply, move_id, fen, keys) VALUES (?, ?, ?, ?, ?)`)
    .run(gameId, seed.ply, moveId, seed.fen, seed.keys.join("\n"));
}

function afterCommit(): void {
  notifyDeadlineChanged();
  flushTournamentEvents();
  flushSimulEvents();
}

export function getGame(id: string): GameState | undefined {
  const cached = getCachedActiveGame(id);
  if (cached) return cached.state;

  const db = getDb();
  const row = db.prepare(`SELECT * FROM games WHERE id = ?`).get(id) as any;
  if (!row) return undefined;
  const game = rowToGameState(row, currentMoveUcis(id));

  if (game.clock.mode === "live" && game.status === "started" && game.ply === game.moves.length) {
    const rebuilt = replay(game, loadSeed(id, game.ply));
    // Only cache a position reconstructed from the active move line and consistent with the stored
    // FEN. A cache miss must never make an inconsistent DB row look trustworthy.
    if (rebuilt.ok && fenOf(rebuilt.position) === row.fen) {
      rememberActiveGame(id, row.white_id, row.black_id, game, row.fen, rebuilt.positionKeys);
    }
  }

  return game;
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
  const moves = currentMoveUcis(id);
  return { ...game, moves };
}

export function getMoveSans(gameId: string): string[] {
  return currentMoveSans(gameId);
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
  currentFen?: string,
): void {
  const row = gameStateToRow(game);
  const fen = currentFen ?? getCachedFenForMoves(id, game.moves) ?? fenAfterMoves(game.initialFen, game.moves, game.variant, loadSeed(id, game.ply));
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

function appendMove(gameId: string, ply: number, uci: string, san: string, playedAt: number): number {
  const info = getDb()
    .prepare(`INSERT INTO moves (game_id, ply, uci, san, played_at) VALUES (?, ?, ?, ?, ?)`)
    .run(gameId, ply, uci, san, playedAt);
  return Number(info.lastInsertRowid);
}

function deactivateMovesAfter(gameId: string, ply: number): void {
  getDb().prepare(`DELETE FROM active_moves WHERE game_id = ? AND ply > ?`).run(gameId, ply);
  getDb().prepare(`DELETE FROM game_snapshots WHERE game_id = ? AND ply > ?`).run(gameId, ply);
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
  const cached = getCachedActiveGameParticipants(id);
  if (cached) return cached;

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
  const cachedAtStart = getCachedActiveGame(id);
  const before = cachedAtStart?.state ?? getGame(id);
  if (!before) return { ok: false as const, error: "not_found" as const };

  const noOpeningAbort = before.clock.mode === "live" && before.ply < 2 && isTournamentSimul2Game(id);
  const gameForMove = noOpeningAbort ? { ...before, deadlineAt: Number.MAX_SAFE_INTEGER } : before;
  const cached = cachedAtStart ?? getCachedActiveGame(id);
  const hasSameLine = cached !== undefined && cached.state.ply === before.ply &&
    cached.state.moves.length === before.moves.length &&
    cached.state.moves.at(-1) === before.moves.at(-1);
  const context: ReplayContext | undefined = cached && hasSameLine
    ? { position: positionFromFen(cached.fen, before.variant), positionKeys: [...cached.positionKeys] }
    : undefined;
  let cachedPositionKeys: string[] | undefined;
  const result = applyMove(
    gameForMove,
    uci,
    now,
    context ? undefined : loadSeed(id, before.ply),
    context,
    (keys) => { cachedPositionKeys = keys; },
  );
  if (!result.ok) return result;
  const state = noOpeningAbort && result.state.status === "started" && result.state.ply < 2
    ? { ...result.state, deadlineAt: Number.MAX_SAFE_INTEGER }
    : result.state;

  const movePlayed = state.moves.length > before.moves.length;
  let san: string | null = null;
  
  if (movePlayed && state.termination !== "timeout") {
    san = result.san ?? null;
    if (!san) {
      throw new Error(`no SAN for ${uci} in game ${id} at ply ${before.ply}`);
    }
    // Never write a ply without its moves row. Throwing rolls back the surrounding transaction.
    const moveId = appendMove(id, state.ply, uci, san, now);
    if (result.snapshot) saveSnapshot(id, moveId, result.snapshot);
    assertMoveRows(id, state.ply);
  }
  
  updateGameState(id, state, null, false, result.fen);

  return { ...result, state, san, movePlayed, cachedFen: result.fen, cachedPositionKeys };
}

/** The closing event carries the final ply and clocks, so clients can finish the game from the event alone. */
function gameOverEvent(gameId: string, state: GameState): GameEvent {
  if (state.status === "started") throw new Error("gameOverEvent called for a running game");
  return {
    type: "game_over",
    gameId,
    status: state.status,
    result: state.result,
    termination: state.termination,
    ply: state.ply,
    whiteMs: state.whiteMs,
    blackMs: state.blackMs,
  };
}

function broadcastGameOver(gameId: string, state: GameState): void {
  if (state.status === "started") return;
  broadcastGameEvent(gameId, gameOverEvent(gameId, state));
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
  if (outcome.ok) refreshActiveGameAfterWrite(id, outcome.state, outcome.cachedFen, outcome.cachedPositionKeys);
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
  if (outcome.ok) refreshActiveGameAfterWrite(gameId, outcome.state, outcome.cachedFen, outcome.cachedPositionKeys);

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
  if (result.ok) refreshActiveGameAfterWrite(gameId, result.state);
  if (result.ok) flushSimulEvents(); 
  if (result.ok && result.state.status !== "started") notifyDeadlineChanged();

  if (result.ok && result.state.status !== "started") notifyDeadlineChanged();
  return result;
}

export function resignAndPersist(gameId: string, userId: number) {
  const r = actAndPersist(gameId, userId, resign);
  if (r.ok) {
    broadcastGameEvent(gameId, gameOverEvent(gameId, r.state));
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
    broadcastGameEvent(gameId, gameOverEvent(gameId, r.state));
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
    broadcastGameEvent(gameId, gameOverEvent(gameId, r.state));
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

  if (outcome.ok) refreshActiveGameAfterWrite(gameId, outcome.state);
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
      deactivateMovesAfter(gameId, state.ply);
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

  if (outcome.ok) refreshActiveGameAfterWrite(gameId, outcome.state);
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
    .prepare(`SELECT COUNT(*) AS n, COALESCE(MAX(ply), 0) AS top
              FROM active_moves WHERE game_id = ?`)
    .get(gameId) as { n: number; top: number };
  if (row.n !== ply || row.top !== ply) {
    throw new Error(`game ${gameId}: ${row.n} move rows (max ply ${row.top}) but ply is ${ply}`);
  }
}