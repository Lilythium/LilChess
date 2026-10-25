import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientMessage } from "@lilchess/shared";
import { createSocketMoveSender, MOVE_CONFIRM_TIMEOUT_MS } from "./moveTransport";

describe("createSocketMoveSender", () => {
  let sent: ClientMessage[];
  let open: boolean;
  let ply: number | undefined;
  let rejected: number;

  const make = () =>
    createSocketMoveSender({
      send: (msg) => {
        if (!open) return false;
        sent.push(msg);
        return true;
      },
      getPly: () => ply,
      onRejected: () => rejected++,
    });

  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    open = true;
    ply = 4;
    rejected = 0;
  });

  afterEach(() => vi.useRealTimers());

  it("sends the move with the ply it was made on", () => {
    expect(make().trySend(4, "e2e4")).toBe(true);
    expect(sent).toEqual([{ type: "move", ply: 4, uci: "e2e4" }]);
  });

  it("does nothing further once the server's move event has advanced the ply", () => {
    const sender = make();
    sender.trySend(4, "e2e4");
    ply = 5; // the move event arrived and was applied
    vi.advanceTimersByTime(MOVE_CONFIRM_TIMEOUT_MS * 2);
    expect(rejected).toBe(0);
  });

  it("asks for a resync and board reset if nothing confirms the move in time", () => {
    make().trySend(4, "e2e4");
    vi.advanceTimersByTime(MOVE_CONFIRM_TIMEOUT_MS - 1);
    expect(rejected).toBe(0);
    vi.advanceTimersByTime(1);
    expect(rejected).toBe(1);
  });

  it("treats an unknown game state as unconfirmed", () => {
    make().trySend(4, "e2e4");
    ply = undefined;
    vi.advanceTimersByTime(MOVE_CONFIRM_TIMEOUT_MS);
    expect(rejected).toBe(1);
  });

  it("reports false without a timer when the socket is not open, so the caller falls back to HTTP", () => {
    open = false;
    expect(make().trySend(4, "e2e4")).toBe(false);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(MOVE_CONFIRM_TIMEOUT_MS * 2);
    expect(rejected).toBe(0);
  });

  it("rejects immediately when the server answers with an error", () => {
    const sender = make();
    sender.trySend(4, "e2e4");
    sender.serverError();
    expect(rejected).toBe(1);
  });

  it("never resends a move that went unconfirmed", () => {
    make().trySend(4, "e2e4");
    vi.advanceTimersByTime(MOVE_CONFIRM_TIMEOUT_MS * 3);
    expect(sent).toHaveLength(1);
  });

  it("stops everything after dispose", () => {
    const sender = make();
    sender.trySend(4, "e2e4");
    sender.dispose();
    vi.advanceTimersByTime(MOVE_CONFIRM_TIMEOUT_MS * 2);
    sender.serverError();
    expect(rejected).toBe(0);
    expect(sender.trySend(4, "d2d4")).toBe(false);
    expect(sent).toHaveLength(1);
  });
});
