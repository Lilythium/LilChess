import { SimulEventSchema, type SimulEvent } from "@lilchess/shared";

export interface SimulSocketHandlers {
  onEvent: (event: SimulEvent) => void;
  onOpen?: () => void;
}

export function connectSimulSocket(simulId: string, handlers: SimulSocketHandlers) {
  let socket: WebSocket | null = null;
  let closedByUser = false;
  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  function open() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/ws/simuls/${simulId}`);
    socket = ws;

    ws.addEventListener("open", () => {
      attempt = 0;
      handlers.onOpen?.();
    });
    ws.addEventListener("message", (ev) => {
      let raw: unknown;
      try { raw = JSON.parse(ev.data as string); } catch { return; }
      const parsed = SimulEventSchema.safeParse(raw);
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