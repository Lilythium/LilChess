import { ServerMessageSchema, type ClientMessage, type GameEvent } from "@lilchess/shared";

export interface GameSocketHandlers {
  onEvent: (event: GameEvent) => void;
  // Called on initial connect AND every reconnect, and whenever a message can't be trusted.
  // The caller must GET /api/games/:id and reconcile local state
  onResyncNeeded: () => void;
  onStatusChange?: (status: "connecting" | "open" | "closed") => void;
  onServerError?: (error: string) => void; // e.g. "ply_mismatch" in reply to our own send
}

export function connectGameSocket(gameId: string, handlers: GameSocketHandlers) {
  let socket: WebSocket | null = null;
  let closedByUser = false;
  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  function open() {
    handlers.onStatusChange?.("connecting");
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(`${proto}//${location.host}/ws/games/${gameId}`);

    socket.addEventListener("open", () => {
      attempt = 0;
      handlers.onStatusChange?.("open");
      handlers.onResyncNeeded();
    });

    socket.addEventListener("message", (ev) => {
      let raw: unknown;
      try {
        raw = JSON.parse(ev.data as string);
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
    });

    socket.addEventListener("close", () => {
      handlers.onStatusChange?.("closed");
      if (!closedByUser) {
        const delay = Math.min(1000 * 2 ** attempt, 15_000);
        attempt += 1;
        reconnectTimer = setTimeout(open, delay);
      }
    });

    socket.addEventListener("error", () => socket?.close());
  }

  function onVisible() {
    if (document.visibilityState !== "visible") return;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      clearTimeout(reconnectTimer);
      attempt = 0;
      open();
    } else {
      handlers.onResyncNeeded(); 
    }
  }

  document.addEventListener("visibilitychange", onVisible);
  open();

  return {
    send(msg: ClientMessage) {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
    },
    close() {
      closedByUser = true;
      clearTimeout(reconnectTimer);
      document.removeEventListener("visibilitychange", onVisible);
      socket?.close();
    },
  };
}