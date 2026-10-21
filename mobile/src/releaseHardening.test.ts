import { beforeEach, describe, expect, it, vi } from "vitest";

// Mobile Phase 9: release-hardening checks that need no device.
// - credentials stay isolated per server and never fall back to browser storage
// - unsupported or malformed servers are rejected with the right error code
// These complement the device checklist in docs/mobile-release-test-plan.md; they do not replace it.

const store = new Map<string, string>();
let native = true;

vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => native } }));
vi.mock("capacitor-secure-storage-plugin", () => ({
  SecureStoragePlugin: {
    set: vi.fn(async ({ key, value }: { key: string; value: string }) => (store.set(key, value), { value: true })),
    get: vi.fn(async ({ key }: { key: string }) => {
      if (!store.has(key)) throw new Error("missing");
      return { value: store.get(key)! };
    }),
    remove: vi.fn(async ({ key }: { key: string }) => ({ value: store.delete(key) })),
    keys: vi.fn(async () => ({ value: [...store.keys()] })),
    clear: vi.fn(async () => (store.clear(), { value: true })),
  },
}));

const {
  clearAllNativeSessionTokens,
  clearNativeSessionToken,
  nativeSessionStorageKey,
  readNativeSessionToken,
  saveNativeSessionToken,
} = await import("./secureSession.js");
const {
  MAX_API_VERSION,
  SERVER_URL_STORAGE_KEY,
  ServerSelectionError,
  describeConnectionFailure,
  normalizeServerAddress,
  validateHealthResponse,
} = await import("./serverSelection.js");

const A = "https://chess.example.com";
const B = "https://other.example.com";
const TOKEN_A = "a".repeat(64);
const TOKEN_B = "b".repeat(64);

beforeEach(() => {
  store.clear();
  native = true;
});

describe("switching servers", () => {
  it("never returns one server's token for another", async () => {
    await saveNativeSessionToken(A, TOKEN_A);
    await saveNativeSessionToken(B, TOKEN_B);
    expect(await readNativeSessionToken(A)).toBe(TOKEN_A);
    expect(await readNativeSessionToken(B)).toBe(TOKEN_B);
    expect(await readNativeSessionToken("https://third.example.com")).toBeNull();
  });

  it("logging out of one server leaves the other signed in", async () => {
    await saveNativeSessionToken(A, TOKEN_A);
    await saveNativeSessionToken(B, TOKEN_B);
    await clearNativeSessionToken(A);
    expect(await readNativeSessionToken(A)).toBeNull();
    expect(await readNativeSessionToken(B)).toBe(TOKEN_B);
  });

  it("treats the same host on a different scheme or port as a different server", async () => {
    await saveNativeSessionToken("https://chess.example.com", TOKEN_A);
    expect(await readNativeSessionToken("http://chess.example.com")).toBeNull();
    expect(await readNativeSessionToken("https://chess.example.com:8443")).toBeNull();
  });

  it("clears every server's token after a fresh install", async () => {
    await saveNativeSessionToken(A, TOKEN_A);
    await saveNativeSessionToken(B, TOKEN_B);
    await clearAllNativeSessionTokens();
    expect(await readNativeSessionToken(A)).toBeNull();
    expect(await readNativeSessionToken(B)).toBeNull();
  });

  it("keeps the selected server address separate from credentials", async () => {
    await saveNativeSessionToken(A, TOKEN_A);
    expect(nativeSessionStorageKey(A)).not.toBe(SERVER_URL_STORAGE_KEY);
    expect([...store.keys()]).not.toContain(SERVER_URL_STORAGE_KEY);
    // The server address itself must never contain the token or any credential.
    expect(nativeSessionStorageKey(A)).not.toContain(TOKEN_A);
  });
});

describe("secure session storage safety", () => {
  it("refuses to store anything that is not a 64-character hex token", async () => {
    for (const bad of ["", "short", "g".repeat(64), `${TOKEN_A}0`, "Bearer " + TOKEN_A]) {
      await expect(saveNativeSessionToken(A, bad)).rejects.toThrow(/invalid session token/);
    }
    expect(store.size).toBe(0);
  });

  it("discards a corrupted stored value instead of sending it to the server", async () => {
    store.set(nativeSessionStorageKey(A), "corrupted");
    expect(await readNativeSessionToken(A)).toBeNull();
    expect(store.has(nativeSessionStorageKey(A))).toBe(false);
  });

  it("never falls back to browser storage when not running natively", async () => {
    native = false;
    await expect(saveNativeSessionToken(A, TOKEN_A)).rejects.toThrow(/native LilChess app/);
    await expect(readNativeSessionToken(A)).rejects.toThrow(/native LilChess app/);
    expect(store.size).toBe(0);
  });
});

describe("unsupported servers and malformed health responses", () => {
  const good = {
    ok: true,
    app: "lilchess",
    version: "1.4.0",
    apiVersion: MAX_API_VERSION,
    features: { guests: true, registration: "invite" },
  };
  const codeOf = (payload: unknown): string => {
    try {
      validateHealthResponse(payload);
    } catch (e) {
      if (e instanceof ServerSelectionError) return e.code;
      throw e;
    }
    return "accepted";
  };

  it("accepts a well-formed response", () => {
    expect(codeOf(good)).toBe("accepted");
  });

  it.each<[string, unknown, string]>([
    ["null", null, "invalid-response"],
    ["an array", [good], "invalid-response"],
    ["a number", 200, "invalid-response"],
    ["an empty string", "", "invalid-response"],
    ["an HTML error page", "<html><body>502 Bad Gateway</body></html>", "invalid-response"],
    ["ok: false", { ...good, ok: false }, "invalid-response"],
    ["ok as the string 'true'", { ...good, ok: "true" }, "invalid-response"],
    ["a missing version", { ...good, version: undefined }, "invalid-response"],
    ["a non-semver version", { ...good, version: "latest" }, "invalid-response"],
    ["missing features", { ...good, features: undefined }, "invalid-response"],
    ["an unknown registration mode", { ...good, features: { guests: true, registration: "maybe" } }, "invalid-response"],
    ["a non-boolean guests flag", { ...good, features: { guests: "yes", registration: "open" } }, "invalid-response"],
    ["another application", { ...good, app: "somethingelse" }, "not-lilchess"],
    ["a missing apiVersion (an old server)", { ...good, apiVersion: undefined }, "incompatible"],
    ["a fractional apiVersion", { ...good, apiVersion: 1.5 }, "incompatible"],
    ["an apiVersion sent as a string", { ...good, apiVersion: "1" }, "incompatible"],
    ["an apiVersion below the supported range", { ...good, apiVersion: 0 }, "incompatible"],
    ["an apiVersion above the supported range", { ...good, apiVersion: MAX_API_VERSION + 1 }, "incompatible"],
  ])("rejects %s", (_label, payload, code) => {
    expect(codeOf(payload)).toBe(code);
  });

  it("tells the user which side to update", () => {
    expect(() => validateHealthResponse({ ...good, apiVersion: MAX_API_VERSION + 1 })).toThrow(/Update the mobile app/);
    expect(() => validateHealthResponse({ ...good, apiVersion: 0 })).toThrow(/Update the server/);
  });

  it("ignores unknown extra fields, so a newer server can add data without breaking the app", () => {
    expect(codeOf({ ...good, newField: { nested: true }, features: { ...good.features, futureFeature: 1 } })).toBe("accepted");
  });

  it("does not repeat the server's response body in an error message", () => {
    const secretish = "<html>token=" + "c".repeat(64) + "</html>";
    try {
      validateHealthResponse(secretish);
    } catch (e) {
      expect((e as Error).message).not.toContain("c".repeat(64));
    }
  });
});

describe("connection failures", () => {
  it("never suggests or performs an HTTPS to HTTP downgrade", () => {
    const https = normalizeServerAddress(A);
    for (const failure of [new Error("SSLHandshakeException"), new Error("timeout"), "connection refused"]) {
      const message = describeConnectionFailure(failure, https);
      expect(message).not.toMatch(/http:\/\//);
      expect(message).not.toMatch(/try http/i);
    }
  });
});
