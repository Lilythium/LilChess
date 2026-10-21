/** Non-secret local preference key. Authentication credentials must use separate storage. */
export const SERVER_URL_STORAGE_KEY = "lilchess.mobile.selectedServerUrl";

/** API compatibility range supported by this mobile client. Bump only with contract review. */
export const MIN_API_VERSION = 1;
export const MAX_API_VERSION = 1;

export type RegistrationMode = "open" | "invite" | "closed";

export interface NormalizedServerAddress {
  /** Canonical origin, without a trailing slash. */
  serverUrl: string;
  /** Absolute API root for this server. */
  apiBaseUrl: string;
  /** Absolute health endpoint used to verify compatibility. */
  healthUrl: string;
  /** WebSocket origin (`ws://` for HTTP, `wss://` for HTTPS). */
  wsBaseUrl: string;
}

export interface LilChessHealth {
  ok: true;
  app: "lilchess";
  version: string;
  apiVersion: number;
  features: {
    guests: boolean;
    registration: RegistrationMode;
    /** Public demo server with a practice bot. Servers that predate Phase 8 omit it, which means false. */
    demo: boolean;
  };
}

export type ServerSelectionErrorCode =
  | "invalid-url"
  | "not-lilchess"
  | "incompatible"
  | "invalid-response"
  | "http"
  | "storage";

export class ServerSelectionError extends Error {
  readonly code: ServerSelectionErrorCode;

  constructor(code: ServerSelectionErrorCode, message: string) {
    super(message);
    this.name = "ServerSelectionError";
    this.code = code;
  }
}

/**
 * Normalize a server origin. Bare hostnames and addresses default to HTTPS; HTTP is used
 * only when explicitly entered. This intentionally does not accept reverse-proxy path prefixes.
 */
export function normalizeServerAddress(input: string): NormalizedServerAddress {
  const raw = input.trim();
  if (!raw) {
    throw new ServerSelectionError("invalid-url", "Enter a server address.");
  }

  const scheme = raw.match(/^([a-z][a-z\d+.-]*):\/\//i);
  const schemeName = scheme?.[1]?.toLowerCase();
  if (schemeName && !["http", "https"].includes(schemeName)) {
    throw new ServerSelectionError(
      "invalid-url",
      `Unsupported URL scheme "${scheme?.[1] ?? schemeName}". Use HTTPS, or explicitly enter HTTP for a trusted local network.`,
    );
  }
  if (/^https?:/i.test(raw) && !/^https?:\/\//i.test(raw)) {
    throw new ServerSelectionError(
      "invalid-url",
      "The server address is malformed. Include // after the HTTP or HTTPS scheme.",
    );
  }

  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new ServerSelectionError(
      "invalid-url",
      "That address is not a valid server URL. Check the hostname, IPv6 brackets, and port.",
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ServerSelectionError("invalid-url", "Only HTTP and HTTPS server URLs are supported.");
  }
  if (parsed.username || parsed.password) {
    throw new ServerSelectionError(
      "invalid-url",
      "Do not include a username or password in the server URL.",
    );
  }
  if (!parsed.hostname) {
    throw new ServerSelectionError("invalid-url", "The server URL must include a hostname or IP address.");
  }
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new ServerSelectionError(
      "invalid-url",
      "Enter the server origin only, without an API path, other path, query, or fragment.",
    );
  }

  const serverUrl = parsed.origin;
  const apiBaseUrl = `${serverUrl}/api`;
  const wsProtocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  const wsBaseUrl = `${wsProtocol}//${parsed.host}`;

  return {
    serverUrl,
    apiBaseUrl,
    healthUrl: `${apiBaseUrl}/health`,
    wsBaseUrl,
  };
}

/** Validate identity, payload shape, and the declared API compatibility contract. */
export function validateHealthResponse(payload: unknown): LilChessHealth {
  let data = payload;
  if (typeof payload === "string") {
    try {
      data = JSON.parse(payload) as unknown;
    } catch {
      throw new ServerSelectionError(
        "invalid-response",
        "The server returned invalid JSON from /api/health.",
      );
    }
  }

  if (!isRecord(data)) {
    throw new ServerSelectionError(
      "invalid-response",
      "The server returned an invalid health response. Expected a JSON object.",
    );
  }
  if (data.ok !== true) {
    throw new ServerSelectionError(
      "invalid-response",
      "The server health response did not report a successful check.",
    );
  }
  if (!Number.isInteger(data.apiVersion)) {
    throw new ServerSelectionError(
      "incompatible",
      "This server does not advertise a mobile-compatible API version. Update the LilChess server and try again.",
    );
  }
  if (data.app !== "lilchess") {
    throw new ServerSelectionError(
      "not-lilchess",
      "This address did not identify itself as a LilChess server. Check the address and try again.",
    );
  }

  const apiVersion = data.apiVersion as number;
  if (apiVersion < MIN_API_VERSION) {
    throw new ServerSelectionError(
      "incompatible",
      `This server uses API version ${apiVersion}; this app requires version ${MIN_API_VERSION} or newer. Update the server.`,
    );
  }
  if (apiVersion > MAX_API_VERSION) {
    throw new ServerSelectionError(
      "incompatible",
      `This server uses API version ${apiVersion}, which this app does not support yet. Update the mobile app.`,
    );
  }

  const version = data.version;
  const features = data.features;
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new ServerSelectionError(
      "invalid-response",
      "The server health response is missing a valid LilChess version.",
    );
  }
  if (
    !isRecord(features) ||
    typeof features.guests !== "boolean" ||
    (features.registration !== "open" &&
      features.registration !== "invite" &&
      features.registration !== "closed") ||
    (features.demo !== undefined && typeof features.demo !== "boolean")
  ) {
    throw new ServerSelectionError(
      "invalid-response",
      "The server health response contains invalid feature-compatibility information.",
    );
  }

  return {
    ok: true,
    app: "lilchess",
    version,
    apiVersion,
    features: {
      guests: features.guests,
      registration: features.registration,
      demo: features.demo === true,
    },
  };
}

/** Turn native networking failures into actionable messages; never retry with a weaker scheme. */
export function describeConnectionFailure(
  error: unknown,
  address: NormalizedServerAddress,
): string {
  if (error instanceof ServerSelectionError) return error.message;

  const details = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : isRecord(error) && typeof error.message === "string"
        ? error.message
        : String(error ?? "");
  if (/(tls|ssl|certificate|certpath|handshake|trust anchor)/i.test(details)) {
    return "TLS/certificate validation failed. Check that the HTTPS certificate is valid and trusted by this device. HTTPS was not downgraded.";
  }
  if (
    address.serverUrl.startsWith("http://") &&
    /(cleartext|clear text|ats|not permitted|blocked by (?:the )?platform|network security policy)/i.test(details)
  ) {
    return "This device blocked unencrypted HTTP. Use HTTPS, or configure platform-approved HTTP access for this trusted local network. The app did not retry using another scheme.";
  }
  return `Could not reach ${address.serverUrl}. Check the address, network connection, firewall, and server status.`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
