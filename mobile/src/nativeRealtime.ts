import { NativeApiError, nativeRequest } from "./nativeApi.js";
import { connectNativeWebSocket } from "./nativeWebSocket.js";
import { readNativeSessionToken } from "./secureSession.js";

/**
 * Thrown when the stored session is missing, expired or revoked. `fatal` tells the socket layer not to retry:
 * the same credentials cannot succeed, so reconnecting would only hammer the server.
 */
export class NativeSessionExpiredError extends Error {
  readonly fatal = true as const;
  readonly status = 401;

  constructor(message = "Your session has expired. Log in again.") {
    super(message);
    this.name = "NativeSessionExpiredError";
  }
}

export interface NativeRealtimeOptions {
  serverUrl: string;
  /** Called once when the server rejects the session. Later calls fail fast without touching the network. */
  onSessionExpired?: () => void;
  // Injection points for tests.
  readToken?: (serverUrl: string) => Promise<string | null>;
  request?: typeof nativeRequest;
  connect?: typeof connectNativeWebSocket;
}

export interface NativeRealtime {
  /** Drop-in for the web client's api(): `/api/...` paths over the native HTTP bridge with the bearer token. */
  api(path: string, init: { method?: string; body?: unknown; responseType?: "json" | "text" }): Promise<unknown>;
  /** Opens a ticket-authenticated socket for `/ws/...`. A fresh single-use ticket is requested every time. */
  openSocket(path: string): Promise<WebSocket>;
  isExpired(): boolean;
}

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

/**
 * Everything the web client needs to talk to one self-hosted server from the Capacitor app. One instance per
 * server: the token is read from secure storage once and kept only in memory, never written elsewhere, and a
 * rejected session latches the instance so an expired or revoked session is not retried.
 */
export function createNativeRealtime(options: NativeRealtimeOptions): NativeRealtime {
  const {
    serverUrl,
    readToken = readNativeSessionToken,
    request = nativeRequest,
    connect = connectNativeWebSocket,
  } = options;

  let expired = false;
  let tokenPromise: Promise<string> | null = null;

  function expire(): void {
    if (expired) return;
    expired = true;
    tokenPromise = null;
    options.onSessionExpired?.();
  }

  function getToken(): Promise<string> {
    if (expired) return Promise.reject(new NativeSessionExpiredError());
    tokenPromise ??= readToken(serverUrl).then(
      (token) => {
        if (token) return token;
        expire();
        throw new NativeSessionExpiredError("You are not signed in on this server.");
      },
      (error: unknown) => {
        tokenPromise = null; // a storage hiccup is not an expired session; try again next time
        throw error;
      },
    );
    return tokenPromise;
  }

  return {
    async api(path, init) {
      if (!path.startsWith("/api/")) throw new TypeError("Native API paths must start with /api/.");
      const method = (init.method ?? (init.body !== undefined ? "POST" : "GET")).toUpperCase();
      if (!METHODS.has(method)) throw new TypeError(`Unsupported HTTP method ${method}.`);

      const token = await getToken();
      try {
        return await request(serverUrl, path.slice("/api".length), {
          method: method as "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
          body: init.body,
          token,
          ...(init.responseType ? { responseType: init.responseType } : {}),
        });
      } catch (error) {
        if (error instanceof NativeApiError && error.status === 401) expire();
        throw error;
      }
    },

    async openSocket(path) {
      const token = await getToken();
      try {
        return await connect(serverUrl, token, path);
      } catch (error) {
        if (error instanceof NativeApiError && error.status === 401) {
          expire();
          throw new NativeSessionExpiredError();
        }
        throw error;
      }
    },

    isExpired: () => expired,
  };
}
