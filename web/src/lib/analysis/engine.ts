import { parseBestMove, parseInfoLine, toWhite, type Color, type Score } from "@lilchess/shared";

/** The thin pipe to a UCI engine. A Web Worker in the browser, anything in tests. */
export interface EngineTransport {
  send(command: string): void;
  onLine(listener: (line: string) => void): void;
  onError(listener: (message: string) => void): void;
  terminate(): void;
}

/** One principal variation. `score` is from White's point of view. */
export interface EngineLine {
  multipv: number;
  depth: number;
  score: Score;
  pv: string[];
}

export interface SearchRequest {
  fen: string;
  chess960: boolean;
  depth: number;
  multipv?: number;
  onUpdate?: (lines: EngineLine[]) => void;
}

export interface SearchResult {
  cancelled: boolean; // superseded by a newer search, stopped, or the engine was disposed
  bestMove: string | null;
  lines: EngineLine[];
}

/** What gameAnalysis needs from an engine (lets tests pass a fake). */
export interface SearchEngine {
  search(request: SearchRequest): Promise<SearchResult>;
  newGame(): Promise<void>;
}

interface ActiveSearch {
  lines: Map<number, EngineLine>;
  turn: Color;
  onUpdate?: (lines: EngineLine[]) => void;
  done: Promise<void>;
  finish: (bestMove: string | null) => void;
}

interface Waiter {
  pattern: RegExp;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const WAIT_TIMEOUT_MS = 60_000; // the first message has to wait for a ~7 MB download + compile

const sortedLines = (lines: Map<number, EngineLine>): EngineLine[] =>
  [...lines.values()].sort((a, b) => a.multipv - b.multipv);

/**
 * One search at a time. A new `search()` stops the running one first, so callers
 * can fire searches as fast as the user clicks and only the latest one counts.
 */
export class Engine implements SearchEngine {
  private waiters: Waiter[] = [];
  private active: ActiveSearch | null = null;
  private latest = 0;
  private disposed = false;
  private failure: Error | null = null;
  private current = { multipv: 1, chess960: false };

  constructor(private readonly transport: EngineTransport) {
    transport.onLine((chunk) => {
      for (const line of chunk.split("\n")) this.handleLine(line.trim());
    });
    transport.onError((message) => this.fail(new Error(message)));
  }

  async init(): Promise<void> {
    await this.command("uci", /^uciok$/);
    await this.command("isready", /^readyok$/);
  }

  async newGame(): Promise<void> {
    this.send("ucinewgame");
    await this.command("isready", /^readyok$/);
  }

  async search(request: SearchRequest): Promise<SearchResult> {
    const token = ++this.latest;
    const cancelled: SearchResult = { cancelled: true, bestMove: null, lines: [] };

    while (this.active) {
      this.send("stop"); // the engine answers a stop with `bestmove`, which ends `active`
      await this.active.done;
    }
    if (this.disposed || token !== this.latest) return cancelled;
    if (this.failure) throw this.failure;

    const multipv = request.multipv ?? 1;
    if (this.current.chess960 !== request.chess960) {
      this.send(`setoption name UCI_Chess960 value ${request.chess960}`);
      this.current.chess960 = request.chess960;
    }
    if (this.current.multipv !== multipv) {
      this.send(`setoption name MultiPV value ${multipv}`);
      this.current.multipv = multipv;
    }

    return new Promise<SearchResult>((resolve) => {
      let finish!: (bestMove: string | null) => void;
      const done = new Promise<void>((markDone) => {
        finish = (bestMove) => {
          markDone();
          resolve({
            cancelled: this.disposed || token !== this.latest,
            bestMove,
            lines: sortedLines(search.lines),
          });
        };
      });
      const search: ActiveSearch = {
        lines: new Map(),
        turn: request.fen.split(" ")[1] === "b" ? "black" : "white",
        onUpdate: request.onUpdate,
        done,
        finish,
      };
      this.active = search;
      this.send(`position fen ${request.fen}`);
      this.send(`go depth ${request.depth}`);
    });
  }

  /** Stops the running search; its promise resolves with `cancelled: true`. */
  stop(): void {
    this.latest++;
    if (this.active) this.send("stop");
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.fail(new Error("engine_disposed"));
    this.transport.terminate();
  }

  private send(command: string): void {
    if (!this.disposed) this.transport.send(command);
  }

  private command(command: string, expect: RegExp): Promise<void> {
    if (this.failure) return Promise.reject(this.failure);
    const waiting = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        reject(new Error("engine_timeout"));
      }, WAIT_TIMEOUT_MS);
      const waiter: Waiter = { pattern: expect, resolve, reject, timer };
      this.waiters.push(waiter);
    });
    this.send(command);
    return waiting;
  }

  private fail(error: Error): void {
    this.failure ??= error;
    for (const w of this.waiters) {
      clearTimeout(w.timer);
      w.reject(error);
    }
    this.waiters = [];
    this.active?.finish(null);
    this.active = null;
  }

  private handleLine(line: string): void {
    if (!line) return;

    const hit = this.waiters.find((w) => w.pattern.test(line));
    if (hit) {
      clearTimeout(hit.timer);
      this.waiters = this.waiters.filter((w) => w !== hit);
      hit.resolve();
      return;
    }

    const search = this.active;
    if (!search) return;

    const info = parseInfoLine(line);
    if (info) {
      if (info.bound) return; // aspiration-window noise, not a real result
      const previous = search.lines.get(info.multipv);
      if (previous && info.depth < previous.depth) return;
      search.lines.set(info.multipv, {
        multipv: info.multipv,
        depth: info.depth,
        score: toWhite(info.score, search.turn),
        pv: info.pv,
      });
      search.onUpdate?.(sortedLines(search.lines));
      return;
    }

    const best = parseBestMove(line);
    if (best) {
      this.active = null;
      search.finish(best.move);
    }
  }
}
