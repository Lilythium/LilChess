import type { TimelineSnapshot, Variant } from "@lilchess/shared";
import { runChessTask, type ChessRequest, type ParseInputResult, type WorkerRequest, type WorkerResponse } from "./chessTasks";

/** The part of a Worker the client uses, so tests can supply a fake. */
export interface WorkerLike {
  postMessage(message: WorkerRequest): void;
  terminate(): void;
  addEventListener(type: "message", listener: (event: { data: WorkerResponse }) => void): void;
  addEventListener(type: "error" | "messageerror", listener: () => void): void;
}

export interface ChessWorkerOptions {
  /** Starts a worker, or returns null when workers are unavailable. Defaults to the bundled chess worker. */
  createWorker?: () => WorkerLike | null;
  /** A worker idle this long is shut down to free its memory (it starts again on the next request). */
  idleMs?: number;
}

interface Pending {
  request: ChessRequest;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export const DEFAULT_IDLE_MS = 30_000;

function startBundledWorker(): WorkerLike | null {
  if (typeof Worker === "undefined") return null;
  return new Worker(new URL("./chess.worker.ts", import.meta.url), { type: "module" }) as unknown as WorkerLike;
}

/**
 * Runs chess tasks in a dedicated Web Worker, started on first use and stopped when idle. If a worker cannot start
 * or dies (an old WebView, a blocked script), the task runs on the main thread instead, so a failure costs smoothness,
 * never functionality. Answers always arrive asynchronously, in the order the requests were made.
 */
export function createChessWorkerClient(options: ChessWorkerOptions = {}) {
  const createWorker = options.createWorker ?? startBundledWorker;
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;

  let worker: WorkerLike | null = null;
  let broken = false;
  let nextId = 1;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const pending = new Map<number, Pending>();

  function inline(request: ChessRequest): Promise<unknown> {
    // A macrotask, so the page can paint a "loading" state before the work blocks the thread.
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        try {
          resolve(runChessTask(request));
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      }, 0);
    });
  }

  function stop(): void {
    clearTimeout(idleTimer);
    worker?.terminate();
    worker = null;
  }

  // The worker failed: finish everything it still owed us on the main thread, and use the main thread from now on.
  function fail(): void {
    broken = true;
    stop();
    const owed = [...pending.values()];
    pending.clear();
    for (const item of owed) inline(item.request).then(item.resolve, item.reject);
  }

  function scheduleIdleStop(): void {
    clearTimeout(idleTimer);
    if (pending.size === 0 && worker) idleTimer = setTimeout(stop, idleMs);
  }

  function onMessage({ data }: { data: WorkerResponse }): void {
    const item = pending.get(data.id);
    if (!item) return;
    pending.delete(data.id);
    if (data.ok) item.resolve(data.value);
    else item.reject(new Error(data.error));
    scheduleIdleStop();
  }

  function ensureWorker(): WorkerLike | null {
    if (broken) return null;
    if (worker) return worker;
    try {
      const created = createWorker();
      if (!created) {
        broken = true;
        return null;
      }
      created.addEventListener("message", onMessage);
      created.addEventListener("error", fail);
      created.addEventListener("messageerror", fail);
      worker = created;
      return created;
    } catch {
      broken = true;
      return null;
    }
  }

  function call(request: ChessRequest): Promise<unknown> {
    const active = ensureWorker();
    if (!active) return inline(request);
    clearTimeout(idleTimer);
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { request, resolve, reject });
      try {
        active.postMessage({ id, request });
      } catch {
        fail(); // also re-runs this request on the main thread
      }
    });
  }

  return {
    /** Parses pasted PGN/FEN text and builds the game's positions, all off the main thread. */
    parseInput: (text: string) => call({ op: "parseInput", text }) as Promise<ParseInputResult>,
    /** Every position of a game as plain data (null if the game is not playable). */
    timeline: (initialFen: string, variant: Variant, moves: string[]) =>
      call({ op: "timeline", initialFen, variant, moves }) as Promise<TimelineSnapshot | null>,
    /** Stops the worker now. Anything still waiting is rejected; the next request starts a fresh worker. */
    dispose(): void {
      stop();
      const owed = [...pending.values()];
      pending.clear();
      for (const item of owed) item.reject(new Error("chess_worker_disposed"));
    },
    /** Whether a worker is running right now (tests and diagnostics). */
    isRunning: () => worker !== null,
  };
}

export type ChessWorkerClient = ReturnType<typeof createChessWorkerClient>;

/** The app-wide client. */
export const chessWorker: ChessWorkerClient = createChessWorkerClient();
