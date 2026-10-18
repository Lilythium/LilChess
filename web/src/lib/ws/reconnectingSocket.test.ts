import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backoffDelay, createReconnectingSocket, type ReconnectingSocketOptions, type SocketStatus } from "./reconnectingSocket";
import { asSocket, FakeWebSocket, fakeLifecycle } from "./testing";

function setup(overrides: Partial<ReconnectingSocketOptions> = {}) {
  const life = fakeLifecycle();
  const statuses: SocketStatus[] = [];
  const onOpen = vi.fn();
  const onMessage = vi.fn();
  const onForeground = vi.fn();
  const onFatal = vi.fn();
  const open = vi.fn(() => asSocket(new FakeWebSocket()));
  const socket = createReconnectingSocket({
    open, onOpen, onMessage, onForeground, onFatal,
    onStatusChange: (s) => statuses.push(s),
    lifecycle: life.lifecycle,
    ...overrides,
  });
  return { socket, life, statuses, onOpen, onMessage, onForeground, onFatal, open };
}

const sockets = () => FakeWebSocket.instances;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", FakeWebSocket);
  FakeWebSocket.instances = [];
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("backoffDelay", () => {
  it("doubles from the base and is capped", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((n) => backoffDelay(n))).toEqual([1000, 2000, 4000, 8000, 15000, 15000, 15000]);
  });

  it("randomises downwards only, by at most the jitter fraction", () => {
    expect(backoffDelay(2, 1000, 15000, 0.25, () => 0)).toBe(4000);
    expect(backoffDelay(2, 1000, 15000, 0.25, () => 1)).toBe(3000);
    expect(backoffDelay(2, 1000, 15000, 0.25, () => 0.5)).toBe(3500);
  });
});

describe("asynchronous transports (native ticket flow)", () => {
  it("opens nothing until the transport resolves, and never starts a second attempt meanwhile", async () => {
    let resolveOpen!: (ws: WebSocket) => void;
    const open = vi.fn(() => new Promise<WebSocket>((r) => { resolveOpen = r; }));
    const { socket, life } = setup({ open });
    life.emit("foreground"); // foreground while the ticket request is still running
    life.emit("online");
    expect(socket.status()).toBe("connecting");
    expect(socket.send("x")).toBe(false); // nothing is queued while connecting
    expect(open).toHaveBeenCalledTimes(1);

    const ws = new FakeWebSocket();
    resolveOpen(asSocket(ws));
    await Promise.resolve();
    ws.serverOpen();
    expect(socket.status()).toBe("open");
  });

  it("only ever asks the transport once while an attempt is pending", async () => {
    const open = vi.fn(() => new Promise<WebSocket>(() => {}));
    const { life } = setup({ open });
    life.emit("foreground");
    life.emit("online");
    vi.advanceTimersByTime(60_000);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("closes a socket that arrives after the caller closed", async () => {
    let resolveOpen!: (ws: WebSocket) => void;
    const { socket, onOpen } = setup({ open: () => new Promise<WebSocket>((r) => { resolveOpen = r; }) });
    socket.close();
    const late = new FakeWebSocket();
    resolveOpen(asSocket(late));
    await Promise.resolve();
    expect(late.closeCalls).toBe(1);
    late.serverOpen();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("closes a socket that arrives after it was superseded by a newer attempt", async () => {
    const resolvers: ((ws: WebSocket) => void)[] = [];
    const { life, socket } = setup({ open: () => new Promise<WebSocket>((r) => resolvers.push(r)), staleAfterMs: 0 });
    // First attempt hangs; simulate it being abandoned by a retry after the transport gave up.
    const first = new FakeWebSocket();
    resolvers[0]!(asSocket(first));
    await Promise.resolve();
    first.serverOpen();
    life.emit("background");
    vi.setSystemTime(Date.now() + 5_000);
    life.emit("foreground"); // hidden longer than staleAfterMs: the open socket is replaced
    expect(first.closeCalls).toBe(1);
    expect(resolvers).toHaveLength(2);

    const second = new FakeWebSocket();
    resolvers[1]!(asSocket(second));
    await Promise.resolve();
    second.serverOpen();
    expect(socket.status()).toBe("open");
  });

  it("retries after a transport failure with backoff", async () => {
    const open = vi.fn()
      .mockRejectedValueOnce(new Error("ticket request failed"))
      .mockResolvedValueOnce(asSocket(new FakeWebSocket()));
    const { statuses } = setup({ open });
    await Promise.resolve(); await Promise.resolve();
    expect(statuses).toEqual(["connecting", "closed"]);
    vi.advanceTimersByTime(999);
    expect(open).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("a thrown (not rejected) open() is a failed attempt too", () => {
    const open = vi.fn(() => { throw new Error("bad url"); });
    const { statuses } = setup({ open });
    expect(statuses).toEqual(["connecting", "closed"]);
    vi.advanceTimersByTime(1000);
    expect(open).toHaveBeenCalledTimes(2);
  });
});

describe("fatal errors (expired session)", () => {
  it("stops retrying, reports unauthorized, and ignores foreground/online", async () => {
    const fatal = Object.assign(new Error("expired"), { fatal: true as const });
    const open = vi.fn().mockRejectedValue(fatal);
    const { statuses, life, onFatal, socket } = setup({ open });
    await Promise.resolve(); await Promise.resolve();
    expect(statuses).toEqual(["connecting", "unauthorized"]);
    expect(onFatal).toHaveBeenCalledWith(fatal);

    vi.advanceTimersByTime(120_000);
    life.emit("foreground");
    life.emit("online");
    socket.retry();
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe("bounded reconnects", () => {
  it("gives up after maxAttempts, then foreground, online and retry() start over", () => {
    const { statuses, life, socket } = setup({ maxAttempts: 2 });
    sockets()[0]!.serverClose();           // failure 1 -> retry in 1s
    vi.advanceTimersByTime(1000);
    sockets()[1]!.serverClose();           // failure 2 -> retry in 2s
    vi.advanceTimersByTime(2000);
    sockets()[2]!.serverClose();           // failure 3 -> give up
    expect(statuses.at(-1)).toBe("failed");
    expect(socket.status()).toBe("failed");

    vi.advanceTimersByTime(600_000);
    expect(sockets()).toHaveLength(3);     // no timer is left running

    life.emit("foreground");
    expect(sockets()).toHaveLength(4);
    sockets()[3]!.serverClose();           // attempt counter was reset: it retries again
    expect(statuses.at(-1)).toBe("closed");

    vi.advanceTimersByTime(1000);
    expect(sockets()).toHaveLength(5);
  });

  it("retry() restarts a failed socket but is a no-op while connecting or open", () => {
    const { socket } = setup({ maxAttempts: 0 });
    sockets()[0]!.serverClose();
    expect(socket.status()).toBe("failed");
    socket.retry();
    expect(sockets()).toHaveLength(2);
    socket.retry();                        // connecting
    expect(sockets()).toHaveLength(2);
    sockets()[1]!.serverOpen();
    socket.retry();                        // open
    expect(sockets()).toHaveLength(2);
  });

  it("a successful open resets the attempt counter", () => {
    const { statuses } = setup({ maxAttempts: 2 });
    sockets()[0]!.serverClose();
    vi.advanceTimersByTime(1000);
    sockets()[1]!.serverOpen();
    sockets()[1]!.serverClose();
    vi.advanceTimersByTime(1000);          // 1s again, not 2s
    expect(sockets()).toHaveLength(3);
    expect(statuses).not.toContain("failed");
  });
});

describe("network and foreground", () => {
  it("reconnects at once when the network comes back instead of waiting out the backoff", () => {
    const { life } = setup();
    sockets()[0]!.serverClose(); // backoff timer running
    expect(sockets()).toHaveLength(1);
    life.emit("online");
    expect(sockets()).toHaveLength(2);
  });

  it("ignores 'online' while open or connecting", () => {
    const { life } = setup();
    life.emit("online");
    expect(sockets()).toHaveLength(1);
    sockets()[0]!.serverOpen();
    life.emit("online");
    expect(sockets()).toHaveLength(1);
  });

  it("with pauseWhenHidden, schedules no reconnects in the background and reconnects on return", () => {
    const { life } = setup({ pauseWhenHidden: true });
    sockets()[0]!.serverOpen();
    life.emit("background");
    sockets()[0]!.serverClose();           // the OS killed it
    vi.advanceTimersByTime(60_000);
    expect(sockets()).toHaveLength(1);
    life.emit("foreground");
    expect(sockets()).toHaveLength(2);
  });

  it("without pauseWhenHidden (browser tabs) keeps retrying in the background", () => {
    const { life } = setup();
    life.emit("background");
    sockets()[0]!.serverClose();
    vi.advanceTimersByTime(1000);
    expect(sockets()).toHaveLength(2);
  });

  it("replaces an 'open' socket that was in the background longer than staleAfterMs", () => {
    const { life, onForeground } = setup({ staleAfterMs: 20_000 });
    sockets()[0]!.serverOpen();
    life.emit("background");
    vi.setSystemTime(Date.now() + 25_000);
    life.emit("foreground");
    expect(sockets()[0]!.closeCalls).toBe(1);
    expect(sockets()).toHaveLength(2);
    expect(onForeground).not.toHaveBeenCalled(); // onOpen of the new socket does the resync
  });

  it("keeps a recently backgrounded socket and asks for a resync, passing how long it was away", () => {
    const { life, onForeground } = setup({ staleAfterMs: 20_000 });
    sockets()[0]!.serverOpen();
    life.emit("background");
    vi.setSystemTime(Date.now() + 5_000);
    life.emit("foreground");
    expect(sockets()).toHaveLength(1);
    expect(onForeground).toHaveBeenCalledExactlyOnceWith(5_000);
  });
});

describe("stale sockets and disposal", () => {
  it("cannot be affected by a socket that was replaced", () => {
    const { life, onOpen, onMessage, statuses } = setup();
    const first = sockets()[0]!;
    first.serverOpen();
    first.serverClose();
    life.emit("foreground");
    const second = sockets()[1]!;
    second.serverOpen();

    const before = statuses.length;
    first.serverOpen();
    first.serverSend("late");
    first.serverClose();
    vi.advanceTimersByTime(60_000);

    expect(onMessage).not.toHaveBeenCalled();
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(statuses).toHaveLength(before);
    expect(sockets()).toHaveLength(2);
  });

  it("delivers messages from the current socket only", () => {
    const { onMessage } = setup();
    sockets()[0]!.serverOpen();
    sockets()[0]!.serverSend("hello");
    expect(onMessage).toHaveBeenCalledExactlyOnceWith("hello");
  });

  it("close() stops reconnecting, unsubscribes, and ignores what the closing socket emits", () => {
    const { socket, life, statuses } = setup();
    sockets()[0]!.serverOpen();
    socket.close();
    expect(life.count()).toBe(0);
    vi.advanceTimersByTime(60_000);
    life.emit("foreground");
    life.emit("online");
    expect(sockets()).toHaveLength(1);
    expect(statuses.at(-1)).toBe("open");
    expect(socket.send("x")).toBe(false);
  });

  it("send() reports whether the message went out and never queues", () => {
    const { socket } = setup();
    expect(socket.send("a")).toBe(false);
    sockets()[0]!.serverOpen();
    expect(socket.send("b")).toBe(true);
    expect(sockets()[0]!.sent).toEqual(["b"]);
  });

  it("an error event closes only its own socket and triggers one reconnect", () => {
    setup();
    sockets()[0]!.emit("error");
    vi.advanceTimersByTime(1000);
    expect(sockets()).toHaveLength(2);
  });
});
