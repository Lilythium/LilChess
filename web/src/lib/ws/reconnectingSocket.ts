// A reconnecting WebSocket with the reliability rules every LilChess socket needs. It knows nothing about
// the protocol (games, simuls, user events) or about how a socket is obtained (browser same-origin or the
// native ticket flow); both are injected. See runtime.ts for the transport and policy wiring.
//
//  - One connection attempt at a time, even when the transport is asynchronous (the native ticket request).
//  - Every callback is tied to the attempt that created it; a replaced, retired or disposed socket (or a
//    late-resolving open() promise) can never touch the current state. Late sockets are closed.
//  - Backoff, optionally bounded: after maxAttempts failed attempts the socket reports "failed" and waits for
//    retry(), a return to the foreground, or the network coming back.
//  - Fatal errors (an expired session) stop reconnecting: retrying with the same credentials cannot succeed.
//  - Mobile background suspension: optionally stop scheduling reconnects while hidden, and distrust a socket
//    that was hidden for a long time, since the OS may have killed it without telling the page.

export type SocketStatus = "connecting" | "open" | "closed" | "failed" | "unauthorized";

export type LifecycleEvent = "foreground" | "background" | "online";

export interface Lifecycle {
  /** Returns an unsubscribe function. */
  subscribe(listener: (event: LifecycleEvent) => void): () => void;
}

/** Errors with `fatal: true` (an expired or revoked session) are never retried. */
export interface FatalSocketError extends Error { fatal: true }

export function isFatalSocketError(error: unknown): error is FatalSocketError {
  return typeof error === "object" && error !== null && (error as { fatal?: unknown }).fatal === true;
}

export interface ReconnectingSocketOptions {
  /** Opens a socket. May be synchronous (browser) or asynchronous (native ticket flow). */
  open: () => WebSocket | Promise<WebSocket>;
  /** Raw text frame from the current socket. */
  onMessage: (data: unknown) => void;
  /** The current socket opened (first connect and every reconnect): re-fetch authoritative state here. */
  onOpen?: () => void;
  onStatusChange?: (status: SocketStatus) => void;
  /**
   * The app returned to the foreground and the socket still looks open. Events may have been missed while
   * the page was suspended, so re-check state. `hiddenForMs` is 0 if the page was never reported hidden.
   */
  onForeground?: (hiddenForMs: number) => void;
  /** Called once for a fatal error (the status becomes "unauthorized"). */
  onFatal?: (error: Error) => void;
  /** Consecutive failed attempts before giving up. Default: never give up. */
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** 0..1 fraction of the delay to randomise downwards. Default 0 (deterministic). */
  jitter?: number;
  random?: () => number;
  /** Don't schedule reconnects while the page is hidden; reconnect when it returns. */
  pauseWhenHidden?: boolean;
  /** An "open" socket hidden for longer than this is replaced rather than trusted. Default: never. */
  staleAfterMs?: number;
  now?: () => number;
  lifecycle?: Lifecycle;
}

export interface ReconnectingSocket {
  /** True if the message went out on an open socket. Nothing is queued. */
  send(data: string): boolean;
  /** Manual retry (after "failed"); a no-op while connecting or open. */
  retry(): void;
  status(): SocketStatus;
  /** Stops everything. The instance cannot be reused. */
  close(): void;
}

export function backoffDelay(
  attempt: number,
  baseDelayMs = 1000,
  maxDelayMs = 15_000,
  jitter = 0,
  random: () => number = Math.random,
): number {
  const raw = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
  if (jitter <= 0) return raw;
  return Math.round(raw * (1 - Math.min(jitter, 1) * random()));
}

/** Browser lifecycle: tab visibility and the `online` event. */
export const browserLifecycle: Lifecycle = {
  subscribe(listener) {
    const onVisibility = () => listener(document.visibilityState === "visible" ? "foreground" : "background");
    const onOnline = () => listener("online");
    document.addEventListener("visibilitychange", onVisibility);
    const target = typeof globalThis.addEventListener === "function" ? globalThis : null;
    target?.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      target?.removeEventListener("online", onOnline);
    };
  },
};

function isThenable<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof (value as { then?: unknown } | null)?.then === "function";
}

export function createReconnectingSocket(options: ReconnectingSocketOptions): ReconnectingSocket {
  const {
    maxAttempts = Infinity,
    baseDelayMs = 1000,
    maxDelayMs = 15_000,
    jitter = 0,
    random = Math.random,
    pauseWhenHidden = false,
    staleAfterMs = Infinity,
    now = Date.now,
    lifecycle = browserLifecycle,
  } = options;

  let socket: WebSocket | null = null;
  let generation = 0;        // bumped whenever the current attempt/socket stops being the current one
  let pending = false;       // an open() promise has not settled yet
  let attempt = 0;           // consecutive failures since the last successful open
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let hidden = false;
  let hiddenAt: number | null = null;
  let status: SocketStatus = "closed";

  function setStatus(next: SocketStatus) {
    status = next;
    options.onStatusChange?.(next);
  }

  function isConnecting(): boolean {
    return pending || socket?.readyState === WebSocket.CONNECTING;
  }

  /** Stop listening to the current socket and close it. Its late events are ignored from here on. */
  function retire() {
    generation += 1;
    const old = socket;
    socket = null;
    pending = false;
    if (old && old.readyState !== WebSocket.CLOSED && old.readyState !== WebSocket.CLOSING) {
      try { old.close(); } catch { /* already gone */ }
    }
  }

  function start() {
    if (disposed) return;
    clearTimeout(timer);
    const mine = ++generation;
    setStatus("connecting");

    let result: WebSocket | Promise<WebSocket>;
    try {
      result = options.open();
    } catch (error) {
      failedToOpen(mine, error);
      return;
    }

    if (isThenable(result)) {
      pending = true;
      result.then(
        (ws) => {
          if (mine !== generation || disposed) {
            // We moved on while the transport was working (disposed, retried). Don't leak a subscription.
            try { ws.close(); } catch { /* already gone */ }
            return;
          }
          pending = false;
          attach(ws, mine);
        },
        (error: unknown) => {
          if (mine !== generation) return;
          pending = false;
          failedToOpen(mine, error);
        },
      );
    } else {
      attach(result, mine);
    }
  }

  function attach(ws: WebSocket, mine: number) {
    socket = ws;

    ws.addEventListener("open", () => {
      if (mine !== generation) return;
      attempt = 0;
      setStatus("open");
      options.onOpen?.();
    });

    ws.addEventListener("message", (event) => {
      if (mine !== generation) return;
      options.onMessage((event as MessageEvent).data);
    });

    ws.addEventListener("close", () => {
      // A socket that has been replaced, retired or disposed must not schedule anything.
      if (mine !== generation || ws !== socket) return;
      setStatus("closed");
      if (!disposed) scheduleReconnect();
    });

    // Close only this socket; the close handler above decides what happens next.
    ws.addEventListener("error", () => ws.close());
  }

  function failedToOpen(mine: number, error: unknown) {
    if (mine !== generation || disposed) return;
    if (isFatalSocketError(error)) {
      generation += 1;
      setStatus("unauthorized");
      options.onFatal?.(error);
      return;
    }
    setStatus("closed");
    scheduleReconnect();
  }

  function scheduleReconnect() {
    clearTimeout(timer);
    if (disposed || status === "unauthorized") return;
    if (attempt >= maxAttempts) {
      setStatus("failed");
      return;
    }
    // While hidden on a phone there is nothing useful to do; the foreground handler reconnects.
    if (pauseWhenHidden && hidden) return;
    const delay = backoffDelay(attempt, baseDelayMs, maxDelayMs, jitter, random);
    attempt += 1;
    timer = setTimeout(start, delay);
  }

  function reconnectNow() {
    clearTimeout(timer);
    attempt = 0;
    start();
  }

  function onLifecycle(event: LifecycleEvent) {
    if (disposed) return;

    if (event === "background") {
      hidden = true;
      hiddenAt = now();
      return;
    }

    if (event === "online") {
      // The network is back: don't wait out the backoff. A fatal state needs new credentials, not a retry.
      if (status === "unauthorized" || isConnecting() || socket?.readyState === WebSocket.OPEN) return;
      reconnectNow();
      return;
    }

    // foreground
    const hiddenForMs = hiddenAt === null ? 0 : now() - hiddenAt;
    hidden = false;
    hiddenAt = null;

    if (status === "unauthorized" || isConnecting()) return;

    if (socket?.readyState === WebSocket.OPEN) {
      if (hiddenForMs > staleAfterMs) {
        // The OS may have dropped the connection without telling us. Replace it; onOpen re-fetches state.
        retire();
        reconnectNow();
      } else {
        options.onForeground?.(hiddenForMs);
      }
      return;
    }

    reconnectNow();
  }

  const unsubscribe = lifecycle.subscribe(onLifecycle);
  start();

  return {
    send(data) {
      if (socket?.readyState !== WebSocket.OPEN) return false;
      socket.send(data);
      return true;
    },

    retry() {
      if (disposed || status === "unauthorized" || isConnecting() || socket?.readyState === WebSocket.OPEN) return;
      reconnectNow();
    },

    status: () => status,

    close() {
      if (disposed) return;
      disposed = true;
      clearTimeout(timer);
      unsubscribe();
      // Bump first so the close event this triggers is treated as stale.
      const old = socket;
      generation += 1;
      socket = null;
      pending = false;
      try { old?.close(); } catch { /* already gone */ }
    },
  };
}
