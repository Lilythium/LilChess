import { ServerMessageSchema, type ClientMessage, type GameEvent } from "@lilchess/shared";
import { createManagedSocket } from "./runtime";
import type { SocketStatus } from "./reconnectingSocket";

export type { SocketStatus };

export interface GameSocketHandlers {
  onEvent: (event: GameEvent) => void;
  // Called on initial connect AND every reconnect, whenever the app returns to the foreground, and whenever a
  // message can't be trusted. The caller must GET /api/games/:id and reconcile local state.
  onResyncNeeded: () => void;
  onStatusChange?: (status: SocketStatus) => void;
  onServerError?: (error: string) => void; // e.g. "ply_mismatch" in reply to our own send
}

export function connectGameSocket(gameId: string, handlers: GameSocketHandlers) {
  const socket = createManagedSocket(`/ws/games/${gameId}`, {
    onOpen: () => handlers.onResyncNeeded(),
    onForeground: () => handlers.onResyncNeeded(),
    onStatusChange: handlers.onStatusChange,

    onMessage(data) {
      let raw: unknown;
      try {
        raw = JSON.parse(data as string);
      } catch {
        console.warn("ignoring non-JSON game message");
        handlers.onResyncNeeded();
        return;
      }

      const parsed = ServerMessageSchema.safeParse(raw);
      if (!parsed.success) {
        // Can't trust our local state if we don't understand what the server said.
        console.warn("ignoring malformed game message", parsed.error.issues[0]);
        handlers.onResyncNeeded();
        return;
      }

      if (parsed.data.type === "error") {
        handlers.onServerError?.(parsed.data.error);
        return;
      }

      handlers.onEvent(parsed.data);
    },
  });

  return {
    /** True if the message went out. Nothing is queued: a move that didn't go out is resolved from fresh state. */
    send: (msg: ClientMessage) => socket.send(JSON.stringify(msg)),
    retry: () => socket.retry(),
    status: () => socket.status(),
    close: () => socket.close(),
  };
}
