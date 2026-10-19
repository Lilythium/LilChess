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

import { NativeApiError, nativeRequest, toRelativeRequest } from "./nativeApi.js";

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

  it("passes query strings and percent-encoded values through to the server", async () => {
    requestMock.mockResolvedValue({ status: 200, data: { ok: true } });
    const fen = encodeURIComponent("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
    await nativeRequest("https://chess.example.com", `/openings?variant=standard&fen=${fen}`, { token: "a".repeat(64) });
    expect(requestMock.mock.calls[0]![0]).toMatchObject({
      url: `https://chess.example.com/api/openings?variant=standard&fen=${fen}`,
    });
  });

  it("returns a successful body verbatim when text is requested (PGN export)", async () => {
    const pgn = '[Event "LilChess game"]\n\n1. e4 e5 *\n';
    requestMock.mockResolvedValue({ status: 200, data: pgn });
    await expect(nativeRequest<string>("https://chess.example.com", "/games/abcdef12/pgn", {
      token: "a".repeat(64), responseType: "text",
    })).resolves.toBe(pgn);
    expect(requestMock.mock.calls[0]![0]).toMatchObject({ responseType: "text" });
  });

  it("still reports JSON errors from a text request", async () => {
    requestMock.mockResolvedValue({ status: 404, data: "{\"error\":\"Game not found\"}" });
    await expect(nativeRequest("https://chess.example.com", "/games/abcdef12/pgn", {
      token: "a".repeat(64), responseType: "text",
    })).rejects.toMatchObject({ status: 404, message: "Game not found" });
  });
});

describe("toRelativeRequest", () => {
  it("accepts ordinary API paths with or without a leading slash", () => {
    expect(toRelativeRequest("/games/abcdef12/move")).toBe("games/abcdef12/move");
    expect(toRelativeRequest("me")).toBe("me");
    expect(toRelativeRequest("/users/" + encodeURIComponent("Zoë"))).toBe("users/Zo%C3%AB");
    expect(toRelativeRequest("/leaderboard/standard?period=week")).toBe("leaderboard/standard?period=week");
  });

  it.each([
    "https://evil.example/", "//evil.example", "/me/../admin", "/me/%2e%2e/admin", "/me/%2E%2E", "/a%2Fb",
    "/a%5Cb", "/me#fragment", "/me?x=1?y=2", "/me?x=a b", "/me?x=<script>", "", "/", "/games//move", "/me%zz",
  ])("rejects %s", (path) => {
    expect(() => toRelativeRequest(path)).toThrow(TypeError);
  });
});
