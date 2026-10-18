export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export interface ApiInit { method?: string; body?: unknown }

/**
 * Replaces fetch() for every api() call. The native app installs one that talks to the selected server through
 * the native HTTP bridge with a bearer token (web/src/native/activate.ts). The browser build never sets one, so
 * its behaviour (same-origin fetch with the session cookie) is unchanged.
 */
export type ApiHandler = (path: string, init: ApiInit) => Promise<unknown>;

let handler: ApiHandler | null = null;

export function setApiHandler(next: ApiHandler | null): void {
  handler = next;
}

export async function api<T = any>(
  path: string,
  init: ApiInit = {},
): Promise<T> {
  if (handler) {
    try {
      return (await handler(path, init)) as T;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      const status = (error as { status?: unknown } | null)?.status;
      throw new ApiError(typeof status === "number" ? status : 0, error instanceof Error ? error.message : String(error));
    }
  }
  const hasBody = init.body !== undefined;
  const res = await fetch(path, {
    method: init.method ?? (hasBody ? "POST" : "GET"),
    headers: hasBody ? { "content-type": "application/json" } : undefined,
    body: hasBody ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `HTTP ${res.status}`);
  return data as T;
}