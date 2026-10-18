// How sockets are obtained and how aggressively they reconnect.
//
// The browser build uses the defaults: a same-origin WebSocket that carries the session cookie, retrying
// forever. The native app installs its own runtime for the selected server (ticket-authenticated sockets,
// bounded retries, background awareness), see web/src/native/activate.ts. Game, simul and user sockets all go
// through createManagedSocket(), so none of them needs to know which runtime is active.

import {
  createReconnectingSocket,
  type Lifecycle,
  type ReconnectingSocket,
  type ReconnectingSocketOptions,
} from "./reconnectingSocket";

export interface SocketTransport {
  /**
   * Open a socket for an application path such as `/ws/games/abc12345`.
   * Reject with an error that has `fatal: true` when the credentials are no longer valid (never retried).
   */
  open(path: string): WebSocket | Promise<WebSocket>;
}

export interface SocketPolicy {
  maxAttempts: number;
  pauseWhenHidden: boolean;
  staleAfterMs: number;
  jitter: number;
}

/** Unchanged web behaviour: retry forever, deterministic backoff, keep retrying in background tabs. */
export const WEB_POLICY: SocketPolicy = { maxAttempts: Infinity, pauseWhenHidden: false, staleAfterMs: Infinity, jitter: 0 };

/**
 * Phones: give up after a bounded number of tries (the user gets a Retry button, and a return to the
 * foreground or the network coming back tries again), stop reconnecting while backgrounded, and replace a
 * socket that was in the background for 20 seconds or more.
 */
export const NATIVE_POLICY: SocketPolicy = { maxAttempts: 8, pauseWhenHidden: true, staleAfterMs: 20_000, jitter: 0.25 };

export interface SocketRuntime {
  transport: SocketTransport;
  policy: SocketPolicy;
  lifecycle?: Lifecycle;
}

export const browserTransport: SocketTransport = {
  open(path) {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return new WebSocket(`${proto}//${location.host}${path}`);
  },
};

const BROWSER_RUNTIME: SocketRuntime = { transport: browserTransport, policy: WEB_POLICY };

let runtime: SocketRuntime = BROWSER_RUNTIME;
const live = new Set<ReconnectingSocket>();

/**
 * Switch runtimes (selecting another server, signing out). Sockets opened under the previous runtime belong to
 * the previous server and are closed, so nothing keeps talking to it and no stale callback can fire.
 */
export function setSocketRuntime(next: SocketRuntime): void {
  for (const socket of [...live]) socket.close();
  live.clear();
  runtime = next;
}

export function resetSocketRuntime(): void {
  setSocketRuntime(BROWSER_RUNTIME);
}

export function getSocketRuntime(): SocketRuntime {
  return runtime;
}

type ManagedOptions = Omit<ReconnectingSocketOptions, "open" | "maxAttempts" | "pauseWhenHidden" | "staleAfterMs" | "jitter" | "lifecycle">;

/** Opens `path` with the active runtime and registers the socket so a runtime switch can dispose of it. */
export function createManagedSocket(path: string, options: ManagedOptions): ReconnectingSocket {
  const active = runtime;
  const inner = createReconnectingSocket({
    ...options,
    open: () => active.transport.open(path),
    maxAttempts: active.policy.maxAttempts,
    pauseWhenHidden: active.policy.pauseWhenHidden,
    staleAfterMs: active.policy.staleAfterMs,
    jitter: active.policy.jitter,
    lifecycle: active.lifecycle,
  });

  const managed: ReconnectingSocket = {
    send: (data) => inner.send(data),
    retry: () => inner.retry(),
    status: () => inner.status(),
    close() {
      live.delete(managed);
      inner.close();
    },
  };
  live.add(managed);
  return managed;
}
