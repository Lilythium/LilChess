import { afterEach, describe, expect, it, vi } from "vitest";
import {
  consumeNativeWebSocketTicket,
  hasNativeWebSocketTicket,
  issueNativeWebSocketTicket,
  NATIVE_WEBSOCKET_TICKET_TTL_MS,
} from "./nativeWebSocketTicket.js";

afterEach(() => vi.useRealTimers());

describe("native WebSocket tickets", () => {
  it("are high-entropy, expire quickly, and can be consumed only once", () => {
    vi.useFakeTimers();
    const sessionHash = "a".repeat(64);
    const ticket = issueNativeWebSocketTicket(sessionHash);
    expect(ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hasNativeWebSocketTicket(ticket)).toBe(true);
    expect(consumeNativeWebSocketTicket(ticket)).toBe(sessionHash);
    expect(hasNativeWebSocketTicket(ticket)).toBe(false);
    expect(consumeNativeWebSocketTicket(ticket)).toBeUndefined();

    const expiring = issueNativeWebSocketTicket("b".repeat(64));
    vi.advanceTimersByTime(NATIVE_WEBSOCKET_TICKET_TTL_MS + 1);
    expect(hasNativeWebSocketTicket(expiring)).toBe(false);
    expect(consumeNativeWebSocketTicket(expiring)).toBeUndefined();
  });

  it("rejects invalid session hashes", () => {
    expect(() => issueNativeWebSocketTicket("not-a-hash")).toThrow(/Invalid session hash/);
  });
});
