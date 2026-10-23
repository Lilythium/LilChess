import { describe, expect, it } from "vitest";
import {
  MAX_API_VERSION,
  MIN_API_VERSION,
  ServerSelectionError,
  describeConnectionFailure,
  featureUnavailableMessage,
  normalizeServerAddress,
  unavailableFeatures,
  validateHealthResponse,
} from "./serverSelection.js";

const validHealth = {
  ok: true,
  app: "lilchess",
  version: "1.2.3",
  apiVersion: 1,
  minClientApiVersion: 1,
  features: { guests: true, registration: "invite", demo: false, accountDeletion: true },
};

describe("normalizeServerAddress", () => {
  it("defaults bare hosts to HTTPS and derives API and WebSocket bases", () => {
    expect(normalizeServerAddress(" chess.example.com/ ")).toEqual({
      serverUrl: "https://chess.example.com",
      apiBaseUrl: "https://chess.example.com/api",
      healthUrl: "https://chess.example.com/api/health",
      wsBaseUrl: "wss://chess.example.com",
    });
  });

  it("normalizes trailing slashes and default ports", () => {
    expect(normalizeServerAddress("https://CHESS.example.com:443/").serverUrl)
      .toBe("https://chess.example.com");
  });

  it("preserves an explicitly selected HTTP port and derives ws://", () => {
    expect(normalizeServerAddress("http://192.168.1.20:3000/")).toMatchObject({
      serverUrl: "http://192.168.1.20:3000",
      apiBaseUrl: "http://192.168.1.20:3000/api",
      healthUrl: "http://192.168.1.20:3000/api/health",
      wsBaseUrl: "ws://192.168.1.20:3000",
    });
  });

  it.each([
    ["", "Enter a server address."],
    ["ftp://chess.example.com", "Unsupported URL scheme"],
    ["capacitor://localhost", "Unsupported URL scheme"],
    ["https://user:secret@chess.example.com", "Do not include a username or password"],
    ["https://chess.example.com/path", "Enter the server origin only"],
    ["https://chess.example.com/?token=x", "Enter the server origin only"],
    ["https://chess.example.com/#fragment", "Enter the server origin only"],
    ["https://chess.example.com:bad", "not a valid server URL"],
    ["https:chess.example.com", "malformed"],
  ])("rejects invalid address %s", (input, message) => {
    expect(() => normalizeServerAddress(input)).toThrow(message);
  });
});

describe("validateHealthResponse", () => {
  it("accepts the explicit LilChess identity, version, API contract, and features", () => {
    expect(validateHealthResponse(validHealth)).toEqual(validHealth);
    expect(MIN_API_VERSION).toBe(1);
    expect(MAX_API_VERSION).toBe(1);
  });

  it("treats a missing accountDeletion flag (older servers) as false", () => {
    const { accountDeletion: _omit, ...legacyFeatures } = validHealth.features;
    const health = validateHealthResponse({ ...validHealth, features: legacyFeatures });
    expect(health.features.accountDeletion).toBe(false);
    expect(() => validateHealthResponse({ ...validHealth, features: { ...validHealth.features, accountDeletion: "yes" } }))
      .toThrow(/feature-compatibility/);
  });

  it("treats a missing demo flag (older servers) as false and accepts demo servers", () => {
    const { demo: _omit, ...legacyFeatures } = validHealth.features;
    expect(validateHealthResponse({ ...validHealth, features: legacyFeatures }).features.demo).toBe(false);
    expect(validateHealthResponse({ ...validHealth, features: { ...validHealth.features, demo: true } }).features.demo).toBe(true);
    expect(() => validateHealthResponse({ ...validHealth, features: { ...validHealth.features, demo: "yes" } }))
      .toThrow(/feature-compatibility/);
  });

  it("accepts JSON text returned by a native HTTP implementation", () => {
    expect(validateHealthResponse(JSON.stringify(validHealth))).toEqual(validHealth);
  });

  it("does not accept { ok: true } as proof of compatibility", () => {
    expect(() => validateHealthResponse({ ok: true })).toThrow(/does not report an API version/);
  });

  it("reports a server that identifies as another application", () => {
    expect(() => validateHealthResponse({ ...validHealth, app: "not-lilchess" }))
      .toThrow(/did not identify itself as a LilChess server/);
  });

  it("tells the person to update the server when it is too old", () => {
    const attempt = () => validateHealthResponse({ ...validHealth, apiVersion: 0, minClientApiVersion: undefined });
    expect(attempt).toThrow(/This server \(LilChess 1\.2\.3\) is too old for this app/);
    expect(attempt).toThrow(/administrator to update LilChess/);
    try {
      attempt();
    } catch (error) {
      expect((error as ServerSelectionError).action).toBe("update-server");
    }
  });

  it("tells the person to update the app when the server no longer serves this app's API level", () => {
    const attempt = () => validateHealthResponse({ ...validHealth, apiVersion: MAX_API_VERSION + 2, minClientApiVersion: MAX_API_VERSION + 2 });
    expect(attempt).toThrow(/needs a newer version of this app/);
    expect(attempt).toThrow(/Update LilChess Mobile from the app store/);
    try {
      attempt();
    } catch (error) {
      expect((error as ServerSelectionError).action).toBe("update-app");
    }
  });

  it("accepts a newer server that still serves this app's API level", () => {
    const health = validateHealthResponse({ ...validHealth, apiVersion: MAX_API_VERSION + 1, minClientApiVersion: MIN_API_VERSION });
    expect(health.apiVersion).toBe(MAX_API_VERSION + 1);
    expect(health.minClientApiVersion).toBe(MIN_API_VERSION);
  });

  it("falls back to the old rule when a server omits minClientApiVersion", () => {
    const { minClientApiVersion: _omit, ...legacy } = validHealth;
    expect(validateHealthResponse(legacy).minClientApiVersion).toBe(1);
    expect(() => validateHealthResponse({ ...legacy, apiVersion: MAX_API_VERSION + 1 })).toThrow(/needs a newer version of this app/);
  });

  it.each([0, -1, 1.5, "1", null, 2])("rejects an invalid minClientApiVersion %s", (value) => {
    expect(() => validateHealthResponse({ ...validHealth, minClientApiVersion: value })).toThrow(/invalid API compatibility range/);
  });

  it("does not mention a version it cannot trust", () => {
    expect(() => validateHealthResponse({ ...validHealth, version: 5, apiVersion: 0, minClientApiVersion: undefined }))
      .toThrow(/^This server is too old/);
  });

  it("rejects malformed JSON and incomplete feature information", () => {
    expect(() => validateHealthResponse("not json")).toThrow(/invalid JSON/);
    expect(() => validateHealthResponse({ ...validHealth, features: { guests: "yes" } }))
      .toThrow(/invalid feature-compatibility information/);
  });
});

describe("unavailableFeatures", () => {
  it("is empty for a current server", () => {
    expect(unavailableFeatures(validateHealthResponse(validHealth))).toEqual({});
  });

  it("explains what is missing, and what to do, for a server that predates a feature", () => {
    const { accountDeletion: _omit, ...legacyFeatures } = validHealth.features;
    const missing = unavailableFeatures(validateHealthResponse({ ...validHealth, features: legacyFeatures }));
    expect(missing).toEqual({ accountDeletion: featureUnavailableMessage("accountDeletion") });
    expect(missing.accountDeletion).toMatch(/administrator to update LilChess/);
  });
});

describe("describeConnectionFailure", () => {
  const https = normalizeServerAddress("https://chess.example.com");
  const http = normalizeServerAddress("http://192.168.1.20:3000");

  it("explains TLS failures without suggesting an insecure fallback", () => {
    const message = describeConnectionFailure(new Error("SSLHandshakeException: certificate failure"), https);
    expect(message).toContain("TLS/certificate validation failed");
    expect(message).toContain("was not downgraded");
  });

  it("explains when platform policy blocks explicitly requested HTTP", () => {
    expect(describeConnectionFailure(new Error("Cleartext traffic not permitted"), http))
      .toContain("device blocked unencrypted HTTP");
  });

  it("uses an actionable generic error for unreachable hosts", () => {
    expect(describeConnectionFailure(new Error("connection refused"), https))
      .toContain("Check the address, network connection, firewall, and server status");
  });
});
