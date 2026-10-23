import { SimulEventSchema, type SimulEvent } from "@lilchess/shared";
import { createManagedSocket } from "./runtime";
import { throttled } from "./throttle";

export interface SimulSocketHandlers {
  onEvent: (event: SimulEvent) => void;
  // First connect, every reconnect, and after a long stay in the background: refetch the simul.
  onOpen?: () => void;
}

const LONG_BACKGROUND_MS = 15_000;
const UNKNOWN_EVENT_RESYNC_MS = 5_000;

export function connectSimulSocket(simulId: string, handlers: SimulSocketHandlers) {
  // An event this client does not understand (a newer server added one) means the overview may be stale: refetch it,
  // as the game socket does, but never more than once per interval.
  const resync = throttled(() => handlers.onOpen?.(), UNKNOWN_EVENT_RESYNC_MS);
  const socket = createManagedSocket(`/ws/simuls/${simulId}`, {
    onOpen: () => handlers.onOpen?.(),
    onForeground: (hiddenForMs) => { if (hiddenForMs >= LONG_BACKGROUND_MS) handlers.onOpen?.(); },
    onMessage(data) {
      let raw: unknown;
      try { raw = JSON.parse(data as string); } catch { resync(); return; }
      const parsed = SimulEventSchema.safeParse(raw);
      if (parsed.success) handlers.onEvent(parsed.data);
      else resync();
    },
  });

  return { retry: () => socket.retry(), close: () => socket.close() };
}
