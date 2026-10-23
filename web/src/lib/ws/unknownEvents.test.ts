import { beforeEach, describe, expect, it, vi } from "vitest";

// The user and simul sockets must treat an event they do not understand like the game socket does: re-check the REST
// state instead of silently ignoring it. This matters when a newer server adds an event type (docs/mobile-compatibility.md).

type Options = { onMessage(data: unknown): void };
let captured: Options | null = null;

vi.mock("./runtime", () => ({
  createManagedSocket: (_path: string, options: Options) => {
    captured = options;
    return { retry: vi.fn(), close: vi.fn(), send: vi.fn(), status: vi.fn() };
  },
}));

import { connectSimulSocket } from "./simulSocket";
import { connectUserSocket } from "./userSocket";

const send = (message: unknown) => captured!.onMessage(typeof message === "string" ? message : JSON.stringify(message));

describe.each([
  ["user socket", () => {
    const handlers = { onEvent: vi.fn(), onOpen: vi.fn() };
    connectUserSocket(handlers);
    return { handlers, known: { type: "simul_started", simulId: "s1", gameId: "g1" } };
  }],
  ["simul socket", () => {
    const handlers = { onEvent: vi.fn(), onOpen: vi.fn() };
    connectSimulSocket("s1", handlers);
    return { handlers, known: { type: "simul_roster", simulId: "s1" } };
  }],
])("%s", (_name, setup) => {
  beforeEach(() => {
    captured = null;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });

  it("delivers a known event without a resync", () => {
    const { handlers, known } = setup();
    send(known);
    expect(handlers.onEvent).toHaveBeenCalledWith(known);
    expect(handlers.onOpen).not.toHaveBeenCalled();
  });

  it("resyncs on an unknown event type and does not deliver it", () => {
    const { handlers } = setup();
    send({ type: "some_future_event", id: 1 });
    expect(handlers.onEvent).not.toHaveBeenCalled();
    expect(handlers.onOpen).toHaveBeenCalledTimes(1);
  });

  it("resyncs on a known type whose fields no longer match, and on non-JSON", () => {
    const { handlers, known } = setup();
    send({ ...known, type: "simul_state", status: "a-status-this-client-has-never-seen" });
    vi.advanceTimersByTime(5_000);
    send("not json");
    expect(handlers.onEvent).not.toHaveBeenCalled();
    expect(handlers.onOpen).toHaveBeenCalledTimes(2);
  });

  it("does not turn a burst of unknown events into a burst of resyncs", () => {
    const { handlers } = setup();
    for (let i = 0; i < 20; i++) send({ type: "some_future_event", i });
    expect(handlers.onOpen).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5_000);
    send({ type: "some_future_event" });
    expect(handlers.onOpen).toHaveBeenCalledTimes(2);
  });
});
