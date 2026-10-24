import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { START_FEN } from "@lilchess/shared";
import { createChessWorkerClient, type WorkerLike } from "./chessWorkerClient";
import { runChessTask, type WorkerRequest, type WorkerResponse } from "./chessTasks";

// A stand-in for a real Worker that answers like chess.worker.ts, on demand.
class FakeWorker implements WorkerLike {
  sent: WorkerRequest[] = [];
  terminated = false;
  private onMessage: ((event: { data: WorkerResponse }) => void)[] = [];
  private onFail: (() => void)[] = [];

  postMessage(message: WorkerRequest): void {
    this.sent.push(message);
  }
  terminate(): void {
    this.terminated = true;
  }
  addEventListener(type: "message" | "error" | "messageerror", listener: never): void {
    if (type === "message") this.onMessage.push(listener);
    else this.onFail.push(listener);
  }

  /** Answers the oldest unanswered request the way the real worker would. */
  answer(index = 0): void {
    const { id, request } = this.sent[index]!;
    for (const l of this.onMessage) l({ data: { id, ok: true, value: runChessTask(request) } });
  }
  reject(index: number, error: string): void {
    const { id } = this.sent[index]!;
    for (const l of this.onMessage) l({ data: { id, ok: false, error } });
  }
  crash(): void {
    for (const l of this.onFail) l();
  }
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const clientWith = (worker: FakeWorker | null, idleMs?: number) =>
  createChessWorkerClient({ createWorker: () => worker, idleMs });

describe("chess worker client", () => {
  it("sends the request to the worker and resolves with its answer", async () => {
    const worker = new FakeWorker();
    const client = clientWith(worker);

    const result = client.timeline(START_FEN, "standard", ["e2e4"]);
    expect(worker.sent).toHaveLength(1);
    expect(worker.sent[0]!.request).toMatchObject({ op: "timeline", moves: ["e2e4"] });
    worker.answer();

    expect((await result)?.sans).toEqual(["e4"]);
  });

  it("keeps concurrent requests apart", async () => {
    const worker = new FakeWorker();
    const client = clientWith(worker);

    const a = client.timeline(START_FEN, "standard", ["e2e4"]);
    const b = client.timeline(START_FEN, "standard", ["d2d4"]);
    worker.answer(1); // answered out of order
    worker.answer(0);

    expect((await a)?.sans).toEqual(["e4"]);
    expect((await b)?.sans).toEqual(["d4"]);
  });

  it("starts one worker and reuses it", async () => {
    let created = 0;
    const worker = new FakeWorker();
    const client = createChessWorkerClient({ createWorker: () => { created++; return worker; } });

    const first = client.parseInput(START_FEN);
    worker.answer(0);
    await first;
    const second = client.parseInput(START_FEN);
    worker.answer(1);
    await second;

    expect(created).toBe(1);
  });

  it("rejects when the worker reports a task error", async () => {
    const worker = new FakeWorker();
    const client = clientWith(worker);
    const result = client.parseInput("x");
    worker.reject(0, "boom");
    await expect(result).rejects.toThrow("boom");
  });

  it("runs on the main thread when no worker can be started", async () => {
    const client = clientWith(null);
    const result = client.timeline(START_FEN, "standard", ["e2e4"]);
    await vi.runAllTimersAsync();
    expect((await result)?.sans).toEqual(["e4"]);
  });

  it("runs on the main thread when creating the worker throws", async () => {
    const client = createChessWorkerClient({ createWorker: () => { throw new Error("blocked"); } });
    const result = client.parseInput(START_FEN);
    await vi.runAllTimersAsync();
    expect((await result).parsed.ok).toBe(true);
  });

  it("finishes pending requests on the main thread when the worker dies, and keeps using the main thread", async () => {
    const worker = new FakeWorker();
    const client = clientWith(worker);

    const pending = client.timeline(START_FEN, "standard", ["e2e4"]);
    worker.crash();
    await vi.runAllTimersAsync();
    expect((await pending)?.sans).toEqual(["e4"]);
    expect(worker.terminated).toBe(true);

    const later = client.timeline(START_FEN, "standard", ["d2d4"]);
    await vi.runAllTimersAsync();
    expect((await later)?.sans).toEqual(["d4"]);
    expect(worker.sent).toHaveLength(1); // nothing more was sent to the dead worker
  });

  it("stops an idle worker and starts a fresh one on the next request", async () => {
    const workers: FakeWorker[] = [];
    const client = createChessWorkerClient({
      createWorker: () => { const w = new FakeWorker(); workers.push(w); return w; },
      idleMs: 1000,
    });

    const first = client.parseInput(START_FEN);
    workers[0]!.answer();
    await first;
    expect(client.isRunning()).toBe(true);

    vi.advanceTimersByTime(1000);
    expect(client.isRunning()).toBe(false);
    expect(workers[0]!.terminated).toBe(true);

    const second = client.parseInput(START_FEN);
    expect(workers).toHaveLength(2);
    workers[1]!.answer();
    expect((await second).parsed.ok).toBe(true);
  });

  it("does not stop the worker while a request is outstanding", () => {
    const worker = new FakeWorker();
    const client = clientWith(worker, 1000);
    void client.parseInput(START_FEN);
    vi.advanceTimersByTime(5000);
    expect(worker.terminated).toBe(false);
  });

  it("rejects what is outstanding on dispose", async () => {
    const worker = new FakeWorker();
    const client = clientWith(worker);
    const result = client.parseInput(START_FEN);
    client.dispose();
    await expect(result).rejects.toThrow("chess_worker_disposed");
    expect(worker.terminated).toBe(true);
  });
});
