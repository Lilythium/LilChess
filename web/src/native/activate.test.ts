import { afterEach, describe, expect, it, vi } from "vitest";

const realtime = vi.hoisted(() => ({
  api: vi.fn(async () => ({ ok: true })),
  openSocket: vi.fn(async () => ({}) as WebSocket),
  isExpired: () => false,
}));
const createNativeRealtime = vi.hoisted(() => vi.fn(() => realtime));
vi.mock("../../../mobile/src/nativeRealtime.js", () => ({ createNativeRealtime }));

import { api } from "../lib/api";
import { getSocketRuntime, NATIVE_POLICY, WEB_POLICY } from "../lib/ws/runtime";
import { activateNativeServer, deactivateNativeServer } from "./activate";

afterEach(() => deactivateNativeServer());

describe("activateNativeServer", () => {
  it("routes api() through the native session and installs the native socket policy", async () => {
    const onExpired = vi.fn();
    activateNativeServer("https://chess.example.com", onExpired);

    expect(createNativeRealtime).toHaveBeenCalledWith({ serverUrl: "https://chess.example.com", onSessionExpired: onExpired });
    await api("/api/games/abcdef12");
    expect(realtime.api).toHaveBeenCalledWith("/api/games/abcdef12", {});
    expect(getSocketRuntime().policy).toBe(NATIVE_POLICY);

    void getSocketRuntime().transport.open("/ws/me");
    expect(realtime.openSocket).toHaveBeenCalledWith("/ws/me");
  });

  it("deactivating restores the browser defaults", () => {
    activateNativeServer("https://chess.example.com");
    deactivateNativeServer();
    expect(getSocketRuntime().policy).toBe(WEB_POLICY);
  });
});
