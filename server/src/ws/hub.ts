import type { WebSocket } from "ws";
import type { GameEvent } from "@lilchess/shared";

const gameSockets = new Map<string, Set<WebSocket>>();

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

export function broadcastGameEvent(gameId: string, event: GameEvent): void {
  const set = gameSockets.get(gameId);
  if (!set || set.size === 0) return;
  const payload = JSON.stringify(event);
  for (const socket of set) {
    if (socket.readyState === socket.OPEN) socket.send(payload);
  }
}