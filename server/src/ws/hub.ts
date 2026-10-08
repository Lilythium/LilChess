import type { WebSocket } from "ws";
import type { GameEvent, UserEvent } from "@lilchess/shared";

const MAX_BUFFERED_BYTES = 1024 * 1024; // a client this far behind is dead or hopeless

const gameSockets = new Map<string, Set<WebSocket>>();
const userSockets = new Map<number, Set<WebSocket>>();

function fanOut(set: Set<WebSocket>, payload: string): void {
  for (const socket of set) {
    if (socket.readyState === socket.OPEN) {
      if (socket.bufferedAmount > MAX_BUFFERED_BYTES) socket.terminate();
      else socket.send(payload);
    } else if (socket.readyState === socket.CLOSED) {
      set.delete(socket); // never keep a dead socket around
    }
  }
}

// --- Game Subscriptions ---

export function subscribe(gameId: string, socket: WebSocket): void {
  let set = gameSockets.get(gameId);
  if (!set) {
    set = new Set();
    gameSockets.set(gameId, set);
  }
  set.add(socket);
}

export function unsubscribe(gameId: string, socket: WebSocket): void {
  const set = gameSockets.get(gameId);
  if (!set) return;
  set.delete(socket);
  if (set.size === 0) gameSockets.delete(gameId);
}

/** Live subscriptions for one game, or across all games. Used by tests and diagnostics. */
export function socketCount(gameId?: string): number {
  if (gameId !== undefined) return gameSockets.get(gameId)?.size ?? 0;
  let n = 0;
  for (const set of gameSockets.values()) n += set.size;
  return n;
}

export function broadcastGameEvent(gameId: string, event: GameEvent): void {
  const set = gameSockets.get(gameId);
  if (!set || set.size === 0) return;
  fanOut(set, JSON.stringify(event));
  if (set.size === 0) gameSockets.delete(gameId);
}

// --- User Subscriptions (for tournament notifications, etc.) ---

export function subscribeUser(userId: number, socket: WebSocket): void {
  let set = userSockets.get(userId);
  if (!set) {
    set = new Set();
    userSockets.set(userId, set);
  }
  set.add(socket);
}

export function unsubscribeUser(userId: number, socket: WebSocket): void {
  const set = userSockets.get(userId);
  if (!set) return;
  set.delete(socket);
  if (set.size === 0) userSockets.delete(userId);
}

export function userSocketCount(userId: number): number {
  return userSockets.get(userId)?.size ?? 0;
}

export function broadcastUserEvent(userId: number, event: UserEvent): void {
  const set = userSockets.get(userId);
  if (!set || set.size === 0) return;
  fanOut(set, JSON.stringify(event));
  if (set.size === 0) userSockets.delete(userId);
}

/** Clean up all subscriptions for a disconnected socket across both games and users. */
export function cleanupSocket(socket: WebSocket): void {
  for (const [gameId, set] of gameSockets.entries()) {
    set.delete(socket);
    if (set.size === 0) gameSockets.delete(gameId);
  }
  for (const [userId, set] of userSockets.entries()) {
    set.delete(socket);
    if (set.size === 0) userSockets.delete(userId);
  }
}