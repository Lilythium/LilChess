// Test doubles shared by the socket tests. Not imported by app code.
import type { Lifecycle, LifecycleEvent } from "./reconnectingSocket";

type Listener = (event?: unknown) => void;

export class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  closeCalls = 0;
  private listeners = new Map<string, Listener[]>();

  constructor(public url = "") { FakeWebSocket.instances.push(this); }

  addEventListener(type: string, fn: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  send(data: string) { this.sent.push(data); }
  close() { this.closeCalls += 1; this.readyState = FakeWebSocket.CLOSED; this.emit("close"); }
  emit(type: string, event?: unknown) { for (const fn of this.listeners.get(type) ?? []) fn(event); }

  serverOpen() { this.readyState = FakeWebSocket.OPEN; this.emit("open"); }
  serverClose() { this.readyState = FakeWebSocket.CLOSED; this.emit("close"); }
  serverSend(data: string) { this.emit("message", { data }); }
}

export function fakeLifecycle() {
  const listeners = new Set<(event: LifecycleEvent) => void>();
  const lifecycle: Lifecycle = {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
  return {
    lifecycle,
    emit: (event: LifecycleEvent) => { for (const listener of [...listeners]) listener(event); },
    count: () => listeners.size,
  };
}

export function asSocket(ws: FakeWebSocket): WebSocket {
  return ws as unknown as WebSocket;
}
