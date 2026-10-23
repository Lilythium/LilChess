import { UserEventSchema, type UserEvent } from "@lilchess/shared";
import { createManagedSocket } from "./runtime";
import { throttled } from "./throttle";

export interface UserSocketHandlers {
  onEvent: (event: UserEvent) => void;
  // Called on the first connect, after every reconnect, and after a long stay in the background: anything
  // pushed while we were disconnected or suspended is lost, so the caller should re-check the REST state.
  onOpen?: () => void;
}

// A page the OS suspended may have missed pushes even though its socket still looks open.
const LONG_BACKGROUND_MS = 15_000;
const UNKNOWN_EVENT_RESYNC_MS = 5_000;

// One socket per tab for server-pushed events (tournament pairings). Reconnects with backoff.
export function connectUserSocket(handlers: UserSocketHandlers) {
  // An event this client does not understand (a newer server added one) means local state may be stale, so re-check
  // the REST state, as the game socket does. Throttled so a chatty server cannot turn it into a request storm.
  const resync = throttled(() => handlers.onOpen?.(), UNKNOWN_EVENT_RESYNC_MS);
  const socket = createManagedSocket("/ws/me", {
    onOpen: () => handlers.onOpen?.(),
    onForeground: (hiddenForMs) => { if (hiddenForMs >= LONG_BACKGROUND_MS) handlers.onOpen?.(); },
    onMessage(data) {
      let raw: unknown;
      try { raw = JSON.parse(data as string); } catch { resync(); return; }
      const parsed = UserEventSchema.safeParse(raw);
      if (parsed.success) handlers.onEvent(parsed.data);
      else resync();
    },
  });

  return { retry: () => socket.retry(), close: () => socket.close() };
}
