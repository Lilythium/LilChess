import { UserEventSchema, type UserEvent } from "@lilchess/shared";
import { createManagedSocket } from "./runtime";

export interface UserSocketHandlers {
  onEvent: (event: UserEvent) => void;
  // Called on the first connect, after every reconnect, and after a long stay in the background: anything
  // pushed while we were disconnected or suspended is lost, so the caller should re-check the REST state.
  onOpen?: () => void;
}

// A page the OS suspended may have missed pushes even though its socket still looks open.
const LONG_BACKGROUND_MS = 15_000;

// One socket per tab for server-pushed events (tournament pairings). Reconnects with backoff.
export function connectUserSocket(handlers: UserSocketHandlers) {
  const socket = createManagedSocket("/ws/me", {
    onOpen: () => handlers.onOpen?.(),
    onForeground: (hiddenForMs) => { if (hiddenForMs >= LONG_BACKGROUND_MS) handlers.onOpen?.(); },
    onMessage(data) {
      let raw: unknown;
      try { raw = JSON.parse(data as string); } catch { return; }
      const parsed = UserEventSchema.safeParse(raw);
      if (parsed.success) handlers.onEvent(parsed.data);
    },
  });

  return { retry: () => socket.retry(), close: () => socket.close() };
}
