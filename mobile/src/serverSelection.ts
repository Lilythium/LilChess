/** Non-secret local preference key. Authentication credentials must use separate storage. */
export const SERVER_URL_STORAGE_KEY = "lilchess.mobile.selectedServerUrl";

/**
 * API compatibility range of this mobile client (policy: docs/mobile-compatibility.md).
 *
 * MIN_API_VERSION is the oldest server `apiVersion` the app still works with.
 * MAX_API_VERSION is the newest `apiVersion` the app was built against. A newer server is still accepted when it says,
 * through `minClientApiVersion`, that it keeps serving apps at this level. Bump only after a contract review.
 */
export const MIN_API_VERSION = 1;
export const MAX_API_VERSION = 1;

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

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
  /**
   * The oldest app API level the server still serves. Servers that predate the field omit it; it then equals
   * `apiVersion`, which is the old rule: the app must know the server's contract.
   */
  minClientApiVersion: number;
  features: {
    guests: boolean;
    registration: RegistrationMode;
    /** Public demo server with a practice bot. Servers that predate Phase 8 omit it, which means false. */
    demo: boolean;
    /** The server has POST /api/me/delete. Servers that predate it omit the flag, which means false. */
    accountDeletion: boolean;
  };
}

/** Optional features the UI must check before offering them. Add a feature here when it is added to `features`. */
export type OptionalFeature = "accountDeletion";

/**
 * What to tell the person when an optional feature is missing on the connected server. Never mention a version
 * number as the reason: say what is unavailable and what they can do about it.
 */
export function featureUnavailableMessage(feature: OptionalFeature): string {
  switch (feature) {
    case "accountDeletion":
      return "This server does not support deleting accounts from the app. Ask the server's administrator to update LilChess, or delete the account from the server's website if it offers that.";
  }
}

/**
 * Messages for the optional features the connected server lacks, keyed by feature. Empty for a current server.
 * The shell hands this to the shared UI, so web code never imports from `mobile/`.
 */
export function unavailableFeatures(health: LilChessHealth): Partial<Record<OptionalFeature, string>> {
  const missing: Partial<Record<OptionalFeature, string>> = {};
  if (!health.features.accountDeletion) missing.accountDeletion = featureUnavailableMessage("accountDeletion");
  return missing;
}

export type ServerSelectionErrorCode =
  | "invalid-url"
  | "not-lilchess"
  | "incompatible"
  | "invalid-response"
  | "http"
  | "storage";

/** Who has to act when a server cannot be used: the server's administrator or the person running the app. */
export type CompatibilityAction = "update-server" | "update-app";

export class ServerSelectionError extends Error {
  readonly code: ServerSelectionErrorCode;
  /** Set only for `incompatible` errors that have a clear fix. */
  readonly action: CompatibilityAction | undefined;

  constructor(code: ServerSelectionErrorCode, message: string, action?: CompatibilityAction) {
    super(message);
    this.name = "ServerSelectionError";
    this.code = code;
    this.action = action;
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
      "This server does not report an API version, so it is too old for this app (or it is not a LilChess server). Ask the server's administrator to update LilChess, or choose another server.",
      "update-server",
    );
  }
  if (data.app !== "lilchess") {
    throw new ServerSelectionError(
      "not-lilchess",
      "This address did not identify itself as a LilChess server. Check the address and try again.",
    );
  }

  const apiVersion = data.apiVersion as number;
  const label = describeServer(data.version);

  // A server that omits the field keeps the original rule: the app has to know the server's own contract.
  const rawMin = data.minClientApiVersion;
  if (rawMin !== undefined && (!Number.isInteger(rawMin) || (rawMin as number) < 1 || (rawMin as number) > apiVersion)) {
    throw new ServerSelectionError(
      "invalid-response",
      "The server health response contains an invalid API compatibility range.",
    );
  }
  const minClientApiVersion = rawMin === undefined ? apiVersion : (rawMin as number);

  if (apiVersion < MIN_API_VERSION) {
    throw new ServerSelectionError(
      "incompatible",
      `${label} is too old for this app, which needs a server with API version ${MIN_API_VERSION} or newer. Ask the server's administrator to update LilChess, or choose another server.`,
      "update-server",
    );
  }
  if (minClientApiVersion > MAX_API_VERSION) {
    throw new ServerSelectionError(
      "incompatible",
      `${label} needs a newer version of this app. Update LilChess Mobile from the app store, or choose another server.`,
      "update-app",
    );
  }

  const version = data.version;
  const features = data.features;
  if (typeof version !== "string" || !SEMVER.test(version)) {
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
    (features.demo !== undefined && typeof features.demo !== "boolean") ||
    (features.accountDeletion !== undefined && typeof features.accountDeletion !== "boolean")
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
    minClientApiVersion,
    features: {
      guests: features.guests,
      registration: features.registration,
      demo: features.demo === true,
      accountDeletion: features.accountDeletion === true,
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

/** "This server (LilChess 1.2.3)" when the version is usable, "This server" otherwise. */
function describeServer(version: unknown): string {
  return typeof version === "string" && SEMVER.test(version) ? `This server (LilChess ${version})` : "This server";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
