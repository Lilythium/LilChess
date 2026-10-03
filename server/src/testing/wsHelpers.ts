import WebSocket from "ws";

export interface WsMessage {
  type: string;
  [key: string]: unknown;
}

export function connectWs(
  port: number,
  gameId: string,
  opts: { sid?: string; origin?: string } = {},
): WebSocket {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/games/${gameId}`, {
    headers: opts.sid ? { Cookie: `sessionId=${opts.sid}` } : {},
    origin: opts.origin,
    perMessageDeflate: false, // avoids "RSV1 must be clear" in tests
  });
  ws.on("error", () => {}); // a rejected upgrade surfaces as an error too
  return ws;
}

export const opened = (ws: WebSocket) =>
  new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("unexpected-response", (_req, res) => reject(new Error(`status ${res.statusCode}`)));
  });

export const rejectedWith = (ws: WebSocket) =>
  new Promise<number>((resolve) => {
    ws.once("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
  });

export const closedWith = (ws: WebSocket) =>
  new Promise<number>((resolve) => {
    ws.once("close", (code) => resolve(code));
  });

// Buffers messages from the moment it's called, so nothing is missed between connect and first read.
export function listen(ws: WebSocket) {
  const queue: WsMessage[] = [];
  const waiters: { resolve: (m: WsMessage) => void; reject: (e: Error) => void }[] = [];
  let failure: Error | undefined;

  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString()) as WsMessage;
    const waiter = waiters.shift();
    if (waiter) waiter.resolve(msg);
    else queue.push(msg);
  });

  const fail = (reason: string) => {
    failure = new Error(reason);
    for (const w of waiters.splice(0)) w.reject(failure);
  };
  ws.on("close", (code, reason) => fail(`closed (${code}): ${reason.toString()}`));
  ws.on("error", (err) => fail(`error: ${err.message}`));

  function next(timeoutMs = 3000): Promise<WsMessage> {
    const queued = queue.shift();
    if (queued) return Promise.resolve(queued);
    if (failure) return Promise.reject(failure);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no message within ${timeoutMs}ms`)), timeoutMs);
      waiters.push({
        resolve: (m) => { clearTimeout(timer); resolve(m); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
    });
  }

  async function nextOfType(type: string): Promise<WsMessage> {
    for (;;) {
      const m = await next();
      if (m.type === type) return m;
    }
  }

  return { next, nextOfType };
}