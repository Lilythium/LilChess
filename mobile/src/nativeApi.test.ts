import { beforeEach, describe, expect, it, vi } from "vitest";

const { requestMock, bridge } = vi.hoisted(() => {
  const requestMock = vi.fn();
  return {
    requestMock,
    bridge: { request: requestMock as (...args: unknown[]) => unknown },
  };
});
vi.mock("@capacitor/core", () => ({
  CapacitorHttp: { request: (...args: unknown[]) => bridge.request(...args) },
}));

import { NativeApiError, nativeRequest } from "./nativeApi.js";

describe("nativeRequest", () => {
  beforeEach(() => {
    requestMock.mockReset();
    bridge.request = requestMock;
  });

  it("uses the selected server, timeout, and bearer Authorization header", async () => {
    requestMock.mockResolvedValue({ status: 200, data: { ok: true } });
    await expect(nativeRequest("https://CHESS.example.com/", "/me", {
      token: "a".repeat(64), timeoutMs: 5_000,
    })).resolves.toEqual({ ok: true });
    expect(requestMock).toHaveBeenCalledWith(expect.objectContaining({
      url: "https://chess.example.com/api/me",
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${"a".repeat(64)}` },
      connectTimeout: 5_000,
      readTimeout: 5_000,
      disableRedirects: true,
    }));
  });

  it("sends JSON bodies without adding cookie credentials", async () => {
    requestMock.mockResolvedValue({ status: 200, data: "{\"ok\":true}" });
    await nativeRequest("https://chess.example.com", "/native/login", {
      method: "POST", body: { username: "alice", password: "secret" },
    });
    const options = requestMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(options.headers).toEqual({ Accept: "application/json", "Content-Type": "application/json" });
    expect(options).not.toHaveProperty("credentials");
  });

  it("maps server errors without retrying unauthorized requests", async () => {
    requestMock.mockResolvedValue({ status: 401, data: { error: "Session expired" } });
    await expect(nativeRequest("https://chess.example.com", "/me", { token: "b".repeat(64) }))
      .rejects.toMatchObject({ status: 401, message: "Session expired" });
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it("rejects unsafe paths, invalid tokens, and unreasonable timeouts before networking", async () => {
    await expect(nativeRequest("https://chess.example.com", "https://evil.example/")).rejects.toThrow(/relative paths/);
    await expect(nativeRequest("https://chess.example.com", "/me", { token: "short" })).rejects.toThrow(/token is invalid/);
    await expect(nativeRequest("https://chess.example.com", "/me", { timeoutMs: 100 })).rejects.toThrow(/between 1000 and 60000/);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("normalizes native transport failures to a status-zero API error", async () => {
    bridge.request = async () => {
      throw new Error("connection refused");
    };
    let thrown: unknown;
    try {
      await nativeRequest("https://chess.example.com", "/health");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(NativeApiError);
    expect(thrown).toMatchObject({ status: 0 });
    expect((thrown as Error).message).toContain("Check the address");
  });
});
