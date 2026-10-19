import { CapacitorHttp } from "@capacitor/core";
import {
  describeConnectionFailure,
  normalizeServerAddress,
} from "./serverSelection.js";

export const DEFAULT_NATIVE_REQUEST_TIMEOUT_MS = 12_000;

export class NativeApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "NativeApiError";
    this.status = status;
  }
}

export interface NativeRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  token?: string;
  /** Applied to both connect and response reads; valid range is 1–60 seconds. */
  timeoutMs?: number;
  /** `text` returns a successful response body verbatim (PGN export). Errors are always parsed as JSON. */
  responseType?: "json" | "text";
}

/**
 * HTTP transport for the Capacitor app. This deliberately uses the native HTTP bridge rather
 * than WebView fetch(), so it does not need CORS or broader Origin/CSRF exceptions on the server.
 * It never retries a failed request and never follows redirects with an Authorization header.
 */
export async function nativeRequest<T = unknown>(
  serverUrl: string,
  path: string,
  options: NativeRequestOptions = {},
): Promise<T> {
  const address = normalizeServerAddress(serverUrl);
  const relativePath = toRelativeRequest(path);

  const timeoutMs = options.timeoutMs ?? DEFAULT_NATIVE_REQUEST_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000) {
    throw new RangeError("Native API timeout must be between 1000 and 60000 milliseconds.");
  }
  if (options.token !== undefined && !/^[a-f\d]{64}$/i.test(options.token)) {
    throw new TypeError("The stored session token is invalid. Sign in again.");
  }

  const url = `${address.apiBaseUrl}/${relativePath}`;
  const hasBody = options.body !== undefined;
  const asText = options.responseType === "text";
  const headers: Record<string, string> = { Accept: asText ? "text/plain, application/x-chess-pgn, application/json" : "application/json" };
  if (hasBody) headers["Content-Type"] = "application/json";
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  let response: { status: number; data?: unknown };
  try {
    response = await CapacitorHttp.request({
      url,
      method: options.method ?? (hasBody ? "POST" : "GET"),
      headers,
      data: options.body,
      connectTimeout: timeoutMs,
      readTimeout: timeoutMs,
      disableRedirects: true,
      ...(asText ? { responseType: "text" as const } : {}),
    });
  } catch (error) {
    throw new NativeApiError(0, describeConnectionFailure(error, address));
  }

  if (asText && response.status >= 200 && response.status < 300) {
    return (typeof response.data === "string" ? response.data : "") as T;
  }
  const data = parseResponseData(response.data);
  if (response.status < 200 || response.status >= 300) {
    const message = isRecord(data) && typeof data.error === "string"
      ? data.error
      : `The server returned HTTP ${response.status}.`;
    throw new NativeApiError(response.status, message);
  }
  return data as T;
}

const PATH_CHARS = /^\/?[A-Za-z\d._~%/-]+$/;
// Everything encodeURIComponent() can produce, plus the query delimiters. No `#`, no second `?`, no spaces.
const QUERY_CHARS = /^[A-Za-z\d._~!*'()%=&+,:-]*$/;

/**
 * Validates an API path (optionally with a query string, e.g. `/openings?variant=standard&fen=...%2F...`) and returns
 * it without the leading slash. Percent-encoding is allowed because callers use encodeURIComponent() for usernames
 * and FENs, but a segment that decodes to `.`, `..` or something containing a slash is rejected, so an encoded
 * traversal cannot escape `/api`.
 */
export function toRelativeRequest(path: string): string {
  const invalid = () => new TypeError("Native API paths must be relative paths under /api.");
  const [pathname, query, ...extra] = path.split("?");
  if (extra.length > 0 || !pathname || !PATH_CHARS.test(pathname)) throw invalid();
  if (query !== undefined && !QUERY_CHARS.test(query)) throw invalid();

  const segments = (pathname.startsWith("/") ? pathname.slice(1) : pathname).split("/");
  for (const segment of segments) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw invalid();
    }
    if (!segment || decoded === "." || decoded === ".." || /[/\\]/.test(decoded)) throw invalid();
  }
  return `${segments.join("/")}${query === undefined ? "" : `?${query}`}`;
}

function parseResponseData(value: unknown): unknown {
  if (typeof value !== "string") return value ?? {};
  if (!value.trim()) return {};
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
