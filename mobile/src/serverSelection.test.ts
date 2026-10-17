import { describe, expect, it } from "vitest";
import {
  MAX_API_VERSION,
  MIN_API_VERSION,
  describeConnectionFailure,
  normalizeServerAddress,
  validateHealthResponse,
} from "./serverSelection.js";

const validHealth = {
  ok: true,
  app: "lilchess",
  version: "1.2.3",
  apiVersion: 1,
  features: { guests: true, registration: "invite" },
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

  it("accepts JSON text returned by a native HTTP implementation", () => {
    expect(validateHealthResponse(JSON.stringify(validHealth))).toEqual(validHealth);
  });

  it("does not accept { ok: true } as proof of compatibility", () => {
    expect(() => validateHealthResponse({ ok: true })).toThrow(/does not advertise a mobile-compatible API version/);
  });

  it("reports a server that identifies as another application", () => {
    expect(() => validateHealthResponse({ ...validHealth, app: "not-lilchess" }))
      .toThrow(/did not identify itself as a LilChess server/);
  });

  it("rejects a server that needs an older or newer API contract", () => {
    expect(() => validateHealthResponse({ ...validHealth, apiVersion: 0 }))
      .toThrow(/Update the server/);
    expect(() => validateHealthResponse({ ...validHealth, apiVersion: 2 }))
      .toThrow(/Update the mobile app/);
  });

  it("rejects malformed JSON and incomplete feature information", () => {
    expect(() => validateHealthResponse("not json")).toThrow(/invalid JSON/);
    expect(() => validateHealthResponse({ ...validHealth, features: { guests: "yes" } }))
      .toThrow(/invalid feature-compatibility information/);
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
