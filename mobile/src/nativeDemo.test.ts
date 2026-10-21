import { beforeEach, describe, expect, it, vi } from "vitest";

const { request, save } = vi.hoisted(() => ({ request: vi.fn(), save: vi.fn() }));
vi.mock("@capacitor/core", () => ({ CapacitorHttp: { request: (...a: unknown[]) => request(...a) } }));
vi.mock("./secureSession.js", () => ({ saveNativeSessionToken: (...a: unknown[]) => save(...a) }));

import { startDemoGame } from "./nativeDemo.js";

const user = { id: 7, username: "guest_ab12cd", created_at: 1, is_admin: 0, is_guest: 1, email: null };
const good = { ok: true, user, sessionToken: "a".repeat(64), gameId: "0123456789" };

describe("startDemoGame", () => {
  beforeEach(() => {
    request.mockReset();
    save.mockReset();
  });

  it("posts to the server's demo endpoint, stores the token for that server and returns the game", async () => {
    request.mockResolvedValue({ status: 200, data: good });
    const result = await startDemoGame("https://demo.example.com");
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ url: "https://demo.example.com/api/native/demo", method: "POST" }));
    expect(save).toHaveBeenCalledWith("https://demo.example.com", "a".repeat(64));
    expect(result).toEqual({ session: { token: "a".repeat(64), user }, gameId: "0123456789" });
  });

  it("stores nothing when the response is malformed", async () => {
    for (const bad of [{ ...good, sessionToken: "short" }, { ...good, gameId: "../etc" }, { ...good, user: {} }, { ok: false }]) {
      request.mockResolvedValue({ status: 200, data: bad });
      await expect(startDemoGame("https://demo.example.com")).rejects.toThrow(/invalid demo response/);
    }
    expect(save).not.toHaveBeenCalled();
  });

  it("surfaces the server's refusal, such as a server that is not in demo mode", async () => {
    request.mockResolvedValue({ status: 404, data: { error: "Not found" } });
    await expect(startDemoGame("https://demo.example.com")).rejects.toMatchObject({ status: 404 });
    expect(save).not.toHaveBeenCalled();
  });
});
