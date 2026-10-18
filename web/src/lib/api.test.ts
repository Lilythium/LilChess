import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, setApiHandler } from "./api";

afterEach(() => {
  setApiHandler(null);
  vi.unstubAllGlobals();
});

describe("api with a handler installed (native app)", () => {
  it("routes requests through the handler instead of fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const handler = vi.fn().mockResolvedValue({ ok: 1 });
    setApiHandler(handler);

    await expect(api("/api/games/x", { body: { a: 1 } })).resolves.toEqual({ ok: 1 });
    expect(handler).toHaveBeenCalledWith("/api/games/x", { body: { a: 1 } });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("turns handler failures into ApiError, keeping the HTTP status", async () => {
    setApiHandler(async () => { throw Object.assign(new Error("Not logged in"), { status: 401 }); });
    const error = await api("/api/me").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, message: "Not logged in" });
  });

  it("uses status 0 for failures without one (offline)", async () => {
    setApiHandler(async () => { throw new Error("offline"); });
    await expect(api("/api/me")).rejects.toMatchObject({ status: 0 });
  });
});

describe("api without a handler (browser)", () => {
  it("keeps using same-origin fetch with credentials", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ hi: true }) });
    vi.stubGlobal("fetch", fetchSpy);
    await expect(api("/api/me")).resolves.toEqual({ hi: true });
    expect(fetchSpy).toHaveBeenCalledWith("/api/me", expect.objectContaining({ method: "GET", credentials: "same-origin" }));
  });
});
