import type { SimulEvent } from "@lilchess/shared";
import { api } from "../api";
import { connectSimulSocket } from "../ws/simulSocket";
import { applySimulEvent } from "./applySimulEvent";
import type { SimulDetail } from "./types";

export interface SimulView {
  status: "loading" | "ready" | "error";
  detail: SimulDetail | null;
  error: string | null;
  offset: number; // serverNow - clientNow
}

export function createSimulStore(simulId: string) {
  const view = $state<SimulView>({ status: "loading", detail: null, error: null, offset: 0 });
  let loading = false;
  let again = false;

  async function resync(): Promise<void> {
    if (loading) { again = true; return; } // collapse bursts of roster events into one refetch
    loading = true;
    try {
      do {
        again = false;
        const body = await api<SimulDetail & { ok: true }>(`/api/simuls/${simulId}`);
        view.detail = body;
        view.offset = body.serverNow - Date.now();
        view.status = "ready";
        view.error = null;
      } while (again);
    } catch (err) {
      view.error = err instanceof Error ? err.message : String(err);
      if (!view.detail) view.status = "error";
    } finally {
      loading = false;
    }
  }

  function onEvent(event: SimulEvent) {
    if (!view.detail) return;
    const next = applySimulEvent(view.detail, event);
    if (next === "resync") void resync();
    else view.detail = next;
  }

  const socket = connectSimulSocket(simulId, { onEvent, onOpen: () => void resync() });
  return { view, resync, destroy: () => socket.close() };
}

// One store (and socket) per simul, shared by the overview page and the board switcher.
// A short grace period before closing lets a board switch hand the lease from one component to the next.
const stores = new Map<string, { store: ReturnType<typeof createSimulStore>; refs: number; timer?: ReturnType<typeof setTimeout> }>();

export function acquireSimulStore(simulId: string) {
  let entry = stores.get(simulId);
  if (!entry) {
    entry = { store: createSimulStore(simulId), refs: 0 };
    stores.set(simulId, entry);
  }
  clearTimeout(entry.timer);
  entry.refs += 1;
  const held = entry;
  return {
    store: held.store,
    release() {
      held.refs -= 1;
      if (held.refs > 0) return;
      held.timer = setTimeout(() => {
        if (held.refs > 0) return;
        held.store.destroy();
        stores.delete(simulId);
      }, 3_000);
    },
  };
}