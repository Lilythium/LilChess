import { afterEach, describe, expect, it, vi } from "vitest";
import { setApiHandler } from "./api";
import { exportPgn, fetchPgn, pgnFileName } from "./pgnExport";
import { setPlatformServices } from "./platform";

const PGN = '[Event "LilChess game"]\n[Result "1-0"]\n\n1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0\n';

afterEach(() => {
  setApiHandler(null);
  setPlatformServices(null);
  vi.unstubAllGlobals();
});

describe("fetchPgn", () => {
  it("asks for text and returns the body", async () => {
    const handler = vi.fn().mockResolvedValue(PGN);
    setApiHandler(handler);
    await expect(fetchPgn("abcdef12")).resolves.toBe(PGN);
    expect(handler).toHaveBeenCalledWith("/api/games/abcdef12/pgn", { method: "GET", responseType: "text" });
  });

  it("rejects ids that are not hex before any request", async () => {
    const handler = vi.fn();
    setApiHandler(handler);
    await expect(fetchPgn("../admin")).rejects.toThrow(/not valid/);
    expect(handler).not.toHaveBeenCalled();
  });

  it("rejects an empty answer", async () => {
    setApiHandler(async () => "  ");
    await expect(fetchPgn("abcdef12")).rejects.toThrow(/empty/);
  });

  it("uses fetch with the session cookie in the browser", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, text: async () => PGN });
    vi.stubGlobal("fetch", fetchSpy);
    await expect(fetchPgn("abcdef12")).resolves.toBe(PGN);
    expect(fetchSpy).toHaveBeenCalledWith("/api/games/abcdef12/pgn", { credentials: "same-origin" });
  });

  it("surfaces the server's JSON error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: "Game not found" }) }));
    await expect(fetchPgn("abcdef12")).rejects.toMatchObject({ status: 404, message: "Game not found" });
  });
});

describe("exportPgn in the app", () => {
  it("shares the PGN text through the system share sheet", async () => {
    setApiHandler(async () => PGN);
    const share = vi.fn().mockResolvedValue(undefined);
    setPlatformServices({ publicOrigin: "https://chess.example.com", copyText: vi.fn(), share });
    await exportPgn("abcdef12");
    expect(share).toHaveBeenCalledWith({ title: pgnFileName("abcdef12"), text: PGN });
  });
});
