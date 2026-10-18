import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createManagedSocket, getSocketRuntime, NATIVE_POLICY, resetSocketRuntime, setSocketRuntime, WEB_POLICY } from "./runtime";
import { asSocket, FakeWebSocket, fakeLifecycle } from "./testing";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.stubGlobal("location", { protocol: "https:", host: "chess.test" });
  vi.stubGlobal("document", { visibilityState: "visible", addEventListener: vi.fn(), removeEventListener: vi.fn() });
  FakeWebSocket.instances = [];
});
afterEach(() => {
  resetSocketRuntime();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("socket runtime", () => {
  it("defaults to same-origin sockets that retry forever (unchanged web behaviour)", () => {
    expect(getSocketRuntime().policy).toBe(WEB_POLICY);
    createManagedSocket("/ws/me", { onMessage: () => {} });
    expect(FakeWebSocket.instances[0]!.url).toBe("wss://chess.test/ws/me");
  });

  it("uses the installed transport and policy, e.g. bounded retries on native", async () => {
    const life = fakeLifecycle();
    const open = vi.fn(async () => asSocket(new FakeWebSocket("native")));
    setSocketRuntime({ transport: { open }, policy: { ...NATIVE_POLICY, jitter: 0, maxAttempts: 1 }, lifecycle: life.lifecycle });

    const statuses: string[] = [];
    createManagedSocket("/ws/games/abcdef12", { onMessage: () => {}, onStatusChange: (s) => statuses.push(s) });
    await Promise.resolve();
    expect(open).toHaveBeenCalledWith("/ws/games/abcdef12");

    FakeWebSocket.instances[0]!.serverClose();   // failure 1 -> one retry allowed
    vi.advanceTimersByTime(1000);
    await Promise.resolve();
    FakeWebSocket.instances[1]!.serverClose();   // failure 2 -> give up
    expect(statuses.at(-1)).toBe("failed");
  });

  it("closes sockets of the previous server when the runtime changes", () => {
    const first = createManagedSocket("/ws/me", { onMessage: () => {} });
    FakeWebSocket.instances[0]!.serverOpen();

    setSocketRuntime({ transport: { open: () => asSocket(new FakeWebSocket("other")) }, policy: WEB_POLICY });

    expect(FakeWebSocket.instances[0]!.closeCalls).toBe(1);
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);   // the old socket did not reconnect to the old server
    expect(first.send("x")).toBe(false);

    createManagedSocket("/ws/me", { onMessage: () => {} });
    expect(FakeWebSocket.instances[1]!.url).toBe("other");
  });

  it("forgets sockets the caller closed itself", () => {
    const socket = createManagedSocket("/ws/me", { onMessage: () => {} });
    socket.close();
    const spy = vi.spyOn(FakeWebSocket.prototype, "close");
    resetSocketRuntime();
    expect(spy).not.toHaveBeenCalled();
  });
});
