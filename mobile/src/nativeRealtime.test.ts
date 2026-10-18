import { describe, expect, it, vi } from "vitest";
import { NativeApiError } from "./nativeApi.js";
import { createNativeRealtime, NativeSessionExpiredError } from "./nativeRealtime.js";

const TOKEN = "a".repeat(64);
const SERVER = "https://chess.example.com";

function setup(overrides: Partial<Parameters<typeof createNativeRealtime>[0]> = {}) {
  const request = vi.fn().mockResolvedValue({ ok: true });
  const socket = {} as WebSocket;
  const connect = vi.fn().mockResolvedValue(socket);
  const readToken = vi.fn().mockResolvedValue(TOKEN);
  const onSessionExpired = vi.fn();
  const realtime = createNativeRealtime({
    serverUrl: SERVER, readToken, request, connect, onSessionExpired, ...overrides,
  } as Parameters<typeof createNativeRealtime>[0]);
  return { realtime, request, connect, readToken, onSessionExpired, socket };
}

describe("createNativeRealtime.api", () => {
  it("sends /api paths over the native bridge with the bearer token", async () => {
    const { realtime, request } = setup();
    await realtime.api("/api/games/abcdef12", {});
    expect(request).toHaveBeenCalledWith(SERVER, "/games/abcdef12", { method: "GET", body: undefined, token: TOKEN });
  });

  it("defaults to POST when there is a body, and passes it through", async () => {
    const { realtime, request } = setup();
    await realtime.api("/api/games/abcdef12/move", { body: { ply: 3, uci: "e2e4" } });
    expect(request).toHaveBeenCalledWith(SERVER, "/games/abcdef12/move", {
      method: "POST", body: { ply: 3, uci: "e2e4" }, token: TOKEN,
    });
  });

  it("reads the token from secure storage once and keeps it only in memory", async () => {
    const { realtime, readToken } = setup();
    await realtime.api("/api/me", {});
    await realtime.api("/api/me", {});
    await realtime.openSocket("/ws/me");
    expect(readToken).toHaveBeenCalledTimes(1);
  });

  it("refuses anything that is not an /api path or a known method", async () => {
    const { realtime, request } = setup();
    await expect(realtime.api("https://evil.example/api/x", {})).rejects.toThrow(TypeError);
    await expect(realtime.api("/api/x", { method: "TRACE" })).rejects.toThrow(/Unsupported HTTP method/);
    expect(request).not.toHaveBeenCalled();
  });

  it("expires the session on the first 401, notifies once, and never hits the network again", async () => {
    const { realtime, request, onSessionExpired } = setup();
    request.mockRejectedValueOnce(new NativeApiError(401, "Not logged in"));

    await expect(realtime.api("/api/games/abcdef12", {})).rejects.toMatchObject({ status: 401 });
    expect(realtime.isExpired()).toBe(true);
    expect(onSessionExpired).toHaveBeenCalledTimes(1);

    await expect(realtime.api("/api/games/abcdef12", {})).rejects.toBeInstanceOf(NativeSessionExpiredError);
    await expect(realtime.api("/api/me", {})).rejects.toBeInstanceOf(NativeSessionExpiredError);
    expect(request).toHaveBeenCalledTimes(1);
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it("does not treat other failures as an expired session", async () => {
    const { realtime, request, onSessionExpired } = setup();
    request.mockRejectedValueOnce(new NativeApiError(0, "offline")).mockRejectedValueOnce(new NativeApiError(500, "boom"));
    await expect(realtime.api("/api/me", {})).rejects.toMatchObject({ status: 0 });
    await expect(realtime.api("/api/me", {})).rejects.toMatchObject({ status: 500 });
    expect(realtime.isExpired()).toBe(false);
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it("treats a missing stored token as an expired session", async () => {
    const { realtime, request, onSessionExpired } = setup({ readToken: vi.fn().mockResolvedValue(null) });
    await expect(realtime.api("/api/me", {})).rejects.toBeInstanceOf(NativeSessionExpiredError);
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
    expect(request).not.toHaveBeenCalled();
  });

  it("retries reading storage after a transient storage failure", async () => {
    const readToken = vi.fn().mockRejectedValueOnce(new Error("keystore busy")).mockResolvedValueOnce(TOKEN);
    const { realtime, request } = setup({ readToken });
    await expect(realtime.api("/api/me", {})).rejects.toThrow("keystore busy");
    expect(realtime.isExpired()).toBe(false);
    await realtime.api("/api/me", {});
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe("createNativeRealtime.openSocket", () => {
  it("asks for a fresh ticket on every connection", async () => {
    const { realtime, connect, socket } = setup();
    await expect(realtime.openSocket("/ws/games/abcdef12")).resolves.toBe(socket);
    await realtime.openSocket("/ws/games/abcdef12");
    expect(connect).toHaveBeenCalledTimes(2);
    expect(connect).toHaveBeenCalledWith(SERVER, TOKEN, "/ws/games/abcdef12");
  });

  it("turns a rejected ticket request into a fatal, non-retryable error", async () => {
    const { realtime, connect, onSessionExpired } = setup();
    connect.mockRejectedValueOnce(new NativeApiError(401, "Unauthorized"));

    const error = await realtime.openSocket("/ws/me").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NativeSessionExpiredError);
    expect(error).toMatchObject({ fatal: true });
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
    expect(realtime.isExpired()).toBe(true);
  });

  it("leaves network failures retryable (no fatal flag)", async () => {
    const { realtime, connect } = setup();
    connect.mockRejectedValueOnce(new NativeApiError(0, "unreachable"));
    const error = await realtime.openSocket("/ws/me").catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 0 });
    expect((error as { fatal?: boolean }).fatal).toBeUndefined();
  });
});
