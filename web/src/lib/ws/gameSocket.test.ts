import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectGameSocket } from "./gameSocket";

type Listener = (ev?: unknown) => void;

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  private listeners = new Map<string, Listener[]>();

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  addEventListener(type: string, fn: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close");
  }
  emit(type: string, ev?: unknown) {
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
  }
  // test helpers
  serverOpen() {
    this.readyState = FakeWebSocket.OPEN;
    this.emit("open");
  }
  serverClose() {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close");
  }
}

let doc: { visibilityState: string; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> };

const handlers = () => ({ onEvent: vi.fn(), onResyncNeeded: vi.fn(), onStatusChange: vi.fn() });
const visibilityListener = () =>
  doc.addEventListener.mock.calls.find((c) => c[0] === "visibilitychange")![1] as () => void;

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.instances = [];
  doc = { visibilityState: "visible", addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.stubGlobal("location", { protocol: "http:", host: "chess.test" });
  vi.stubGlobal("document", doc);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("connectGameSocket", () => {
  it("connects to the game path, using wss on https", () => {
    connectGameSocket("abc12345", handlers());
    expect(FakeWebSocket.instances[0]!.url).toBe("ws://chess.test/ws/games/abc12345");

    vi.stubGlobal("location", { protocol: "https:", host: "chess.test" });
    connectGameSocket("abc12345", handlers());
    expect(FakeWebSocket.instances[1]!.url).toBe("wss://chess.test/ws/games/abc12345");
  });

  it("asks for a resync on the first open", () => {
    const h = handlers();
    connectGameSocket("g", h);
    expect(h.onResyncNeeded).not.toHaveBeenCalled();
    FakeWebSocket.instances[0]!.serverOpen();
    expect(h.onResyncNeeded).toHaveBeenCalledTimes(1);
  });

  it("reconnects after a drop and resyncs again (the missed-move case)", () => {
    const h = handlers();
    connectGameSocket("g", h);
    FakeWebSocket.instances[0]!.serverOpen();
    FakeWebSocket.instances[0]!.serverClose();

    vi.advanceTimersByTime(1_000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    FakeWebSocket.instances[1]!.serverOpen();

    expect(h.onResyncNeeded).toHaveBeenCalledTimes(2);
    expect(h.onStatusChange.mock.calls.map((c) => c[0])).toEqual([
      "connecting", "open", "closed", "connecting", "open",
    ]);
  });

  it("backs off exponentially while the server stays down", () => {
    connectGameSocket("g", handlers());
    FakeWebSocket.instances[0]!.serverClose(); // attempt 0 -> 1s
    vi.advanceTimersByTime(1_000);
    expect(FakeWebSocket.instances).toHaveLength(2);

    FakeWebSocket.instances[1]!.serverClose(); // attempt 1 -> 2s
    vi.advanceTimersByTime(1_999);
    expect(FakeWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(3);
  });

  it("does not reconnect after the caller closes it", () => {
    const sock = connectGameSocket("g", handlers());
    FakeWebSocket.instances[0]!.serverOpen();
    sock.close();
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(doc.removeEventListener).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
  });

  it("parses incoming messages into events", () => {
    const h = handlers();
    connectGameSocket("g", h);
    const event = { type: "draw_offer", gameId: "g", by: "white" };
    FakeWebSocket.instances[0]!.emit("message", { data: JSON.stringify(event) });
    expect(h.onEvent).toHaveBeenCalledWith(event);
  });

  it("resyncs when the tab becomes visible with a live socket", () => {
    const h = handlers();
    connectGameSocket("g", h);
    FakeWebSocket.instances[0]!.serverOpen();
    visibilityListener()();
    expect(h.onResyncNeeded).toHaveBeenCalledTimes(2);
  });

  it("reconnects immediately when the tab becomes visible with a dead socket", () => {
    connectGameSocket("g", handlers());
    FakeWebSocket.instances[0]!.serverOpen();
    FakeWebSocket.instances[0]!.serverClose(); // reconnect timer pending
    visibilityListener()();
    expect(FakeWebSocket.instances).toHaveLength(2); // no waiting for the backoff timer
  });

  it("only sends while the socket is open", () => {
    const sock = connectGameSocket("g", handlers());
    const ws = FakeWebSocket.instances[0]!;
    sock.send({ type: "move", ply: 0, uci: "e2e4" });
    expect(ws.sent).toEqual([]);
    ws.serverOpen();
    sock.send({ type: "move", ply: 0, uci: "e2e4" });
    expect(ws.sent).toEqual([JSON.stringify({ type: "move", ply: 0, uci: "e2e4" })]);
  });
});