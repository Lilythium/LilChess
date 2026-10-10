import type { Color, GameResult, SimulEvent, Termination, UserEvent } from "@lilchess/shared";
import { getDb } from "../db/connection.js";
import { broadcastSimulEvent, broadcastUserEvent } from "../ws/hub.js";

const boardsToAnnounce = new Set<string>();
const simulEvents: SimulEvent[] = [];
const userEvents: { userId: number; event: UserEvent }[] = [];

export const queueSimulBoard = (gameId: string): void => void boardsToAnnounce.add(gameId);
export const queueSimulEvent = (event: SimulEvent): void => void simulEvents.push(event);
export const queueSimulUserEvent = (userId: number, event: UserEvent): void => void userEvents.push({ userId, event });

/** After a failed transaction: nothing queued during it was committed. */
export function discardQueuedSimulEvents(): void {
  simulEvents.length = 0;
  userEvents.length = 0;
}

interface BoardRow {
  simulId: string; ply: number; fen: string; lastMove: string | null;
  status: "started" | "finished" | "aborted"; result: GameResult | null; termination: Termination | null;
  whiteMs: number; blackMs: number; deadlineAt: number; drawOfferedBy: Color | null;
}

/** Call after the transaction has committed. Games that aren't in a simul simply find no row. */
export function flushSimulEvents(): void {
  const db = getDb();
  const board = db.prepare(`
    SELECT sp.simul_id AS simulId, g.ply, g.fen, g.last_move AS lastMove, g.status, g.result, g.termination,
           g.white_ms AS whiteMs, g.black_ms AS blackMs, g.deadline_at AS deadlineAt, g.draw_offered_by AS drawOfferedBy
    FROM simul_players sp JOIN games g ON g.id = sp.game_id
    WHERE sp.game_id = ?
  `);
  const finishedIn = new Set<string>();

  for (const gameId of boardsToAnnounce) {
    const row = board.get(gameId) as BoardRow | undefined;
    if (!row) continue;
    broadcastSimulEvent(row.simulId, {
      type: "simul_board",
      simulId: row.simulId,
      gameId,
      ply: row.ply,
      turn: row.ply % 2 === 0 ? "white" : "black",
      fen: row.fen,
      lastMove: row.lastMove,
      status: row.status,
      result: row.result ?? undefined,
      termination: row.termination ?? undefined,
      whiteMs: row.whiteMs,
      blackMs: row.blackMs,
      deadlineAt: row.deadlineAt,
      drawOfferedBy: row.drawOfferedBy,
    });
    if (row.status !== "started") finishedIn.add(row.simulId);
  }
  boardsToAnnounce.clear();

  // The trigger completes a simul in the same transaction as its last game.
  for (const simulId of finishedIn) {
    const s = db.prepare(`SELECT status FROM simuls WHERE id = ?`).get(simulId) as { status: "completed" | string } | undefined;
    if (s?.status === "completed") broadcastSimulEvent(simulId, { type: "simul_state", simulId, status: "completed" });
  }
  for (const event of simulEvents.splice(0)) broadcastSimulEvent(event.simulId, event);
  for (const { userId, event } of userEvents.splice(0)) broadcastUserEvent(userId, event);
}