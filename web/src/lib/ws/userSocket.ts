import { UserEventSchema, type UserEvent } from "@lilchess/shared";

export interface UserSocketHandlers {
  onEvent: (event: UserEvent) => void;
  // Called on the first connect and after every reconnect: anything pushed while we were
  // disconnected is lost, so the caller should re-check the REST state.
  onOpen?: () => void;
}

// One socket per tab for server-pushed events (tournament pairings). Reconnects with backoff.
export function connectUserSocket(handlers: UserSocketHandlers) {
  let socket: WebSocket | null = null;
  let closedByUser = false;
  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  function open() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/ws/me`);
    socket = ws;

    ws.addEventListener("open", () => {
      attempt = 0;
      handlers.onOpen?.();
    });

    ws.addEventListener("message", (ev) => {
      let raw: unknown;
      try { raw = JSON.parse(ev.data as string); } catch { return; }
      const parsed = UserEventSchema.safeParse(raw);
      if (parsed.success) handlers.onEvent(parsed.data);
    });

    ws.addEventListener("close", () => {
      if (ws !== socket || closedByUser) return;
      reconnectTimer = setTimeout(open, Math.min(1000 * 2 ** attempt, 15_000));
      attempt += 1;
    });

    ws.addEventListener("error", () => ws.close());
  }

  function onVisible() {
    if (document.visibilityState !== "visible") return;
    if (socket?.readyState === WebSocket.CONNECTING || socket?.readyState === WebSocket.OPEN) return;
    clearTimeout(reconnectTimer);
    attempt = 0;
    open();
  }

  document.addEventListener("visibilitychange", onVisible);
  open();

  return {
    close() {
      closedByUser = true;
      clearTimeout(reconnectTimer);
      document.removeEventListener("visibilitychange", onVisible);
      socket?.close();
    },
  };
}