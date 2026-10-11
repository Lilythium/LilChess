import type { PositionEval } from "@lilchess/shared";
import { Engine, type EngineLine } from "./engine";
import { engineOnByDefault, readNetEnv } from "./engineDefault";
import { analyseGame } from "./gameAnalysis";
import { createWorkerTransport } from "./workerTransport";

const ENABLED_KEY = "lilchess.analysis.enabled";
// Versioned by the file name: bump this and the copy script together when upgrading Stockfish.
const ENGINE_URL = `${import.meta.env.BASE_URL}stockfish/stockfish-18-lite-single.js`;

export const LIVE_DEPTH = 18;
export const LIVE_LINES = 3;

export const DEPTH_PRESETS = [
  { label: "Fast", depth: 10 },
  { label: "Normal", depth: 14 },
  { label: "Deep", depth: 18 },
] as const;

export type SessionStatus = "off" | "loading" | "ready" | "error";

/** The saved choice, or null if the user has never made one. */
function readStored(): boolean | null {
  try {
    const value = localStorage.getItem(ENABLED_KEY);
    return value === null ? null : value !== "0";
  } catch {
    return null;
  }
}

function writeEnabled(on: boolean): void {
  try {
    localStorage.setItem(ENABLED_KEY, on ? "1" : "0");
  } catch {
    // private mode / storage blocked: the choice just won't persist
  }
}

/**
 * Owns the engine for one analysis page: lazy loading, live evaluation of the
 * position on screen, and the whole-game run. The engine (and its ~7 MB download)
 * only exists while analysis is enabled.
 *
 * One engine can't do two jobs, so live evaluation is paused while a game run is
 * in progress; the page shows the stored evaluation for the position instead.
 */
export function createAnalysisSession() {
  // An explicit choice wins. Otherwise the engine starts on unless the connection looks metered.
  const stored = readStored();
  const startEnabled = stored ?? engineOnByDefault(readNetEnv());

  const view = $state({
    enabled: startEnabled,
    autoOff: stored === null && !startEnabled, // off only because of the connection, not by choice
    status: "off" as SessionStatus,
    error: null as string | null,
    live: { fen: "", depth: 0, lines: [] as EngineLine[], searching: false },
    full: { running: false, done: 0, total: 0, evals: [] as (PositionEval | undefined)[] },
  });

  let engine: Engine | null = null;
  let loading: Promise<Engine | null> | null = null;
  let abort: AbortController | null = null;

  function ensureEngine(): Promise<Engine | null> {
    if (engine) return Promise.resolve(engine);
    loading ??= (async () => {
      view.status = "loading";
      view.error = null;
      try {
        const next = new Engine(createWorkerTransport(ENGINE_URL));
        await next.init();
        if (!view.enabled) { // switched off while loading
          next.dispose();
          return null;
        }
        engine = next;
        view.status = "ready";
        return next;
      } catch (err) {
        view.status = "error";
        view.error = err instanceof Error && err.message !== "engine_timeout"
          ? "The engine failed to start in this browser."
          : "The engine took too long to load.";
        return null;
      } finally {
        loading = null;
      }
    })();
    return loading;
  }

  async function analysePosition(fen: string, chess960: boolean): Promise<void> {
    if (!view.enabled || view.full.running) return;
    const e = await ensureEngine();
    if (!e || !view.enabled || view.full.running) return;

    view.live.fen = fen;
    view.live.lines = [];
    view.live.depth = 0;
    view.live.searching = true;

    try {
      const result = await e.search({
        fen,
        chess960,
        depth: LIVE_DEPTH,
        multipv: LIVE_LINES,
        onUpdate: (lines) => {
          if (view.live.fen !== fen) return; // a newer position took over
          view.live.lines = lines;
          view.live.depth = lines[0]?.depth ?? 0;
        },
      });
      if (!result.cancelled && view.live.fen === fen) view.live.searching = false;
    } catch {
      view.live.searching = false;
    }
  }

  function clearLive(fen = ""): void {
    engine?.stop();
    view.live.fen = fen;
    view.live.lines = [];
    view.live.depth = 0;
    view.live.searching = false;
  }

  async function runFull(fens: string[], chess960: boolean, depth: number): Promise<void> {
    if (view.full.running) return;
    const e = await ensureEngine();
    if (!e) return;

    clearLive();
    const run = new AbortController();
    abort = run;
    view.full.running = true;
    view.full.done = 0;
    view.full.total = fens.length;
    view.full.evals = new Array(fens.length).fill(undefined);

    // resetFull() may replace the run while the engine is still winding down; only the current run may write.
    const current = () => abort === run;
    try {
      const evals = await analyseGame(e, fens, {
        chess960,
        depth,
        signal: run.signal,
        onProgress: (done, partial) => {
          if (!current()) return;
          view.full.done = done;
          view.full.evals = [...partial];
        },
      });
      if (current()) view.full.evals = evals;
    } catch {
      if (current()) view.error = "Analysis was interrupted.";
    } finally {
      if (current()) {
        view.full.running = false;
        abort = null;
      }
    }
  }

  /** Forgets any game analysis (a different game is being opened). */
  function resetFull(): void {
    cancelFull();
    abort = null;
    view.full.running = false;
    view.full.done = 0;
    view.full.total = 0;
    view.full.evals = [];
  }

  /** Shows a previously saved analysis without touching the engine. */
  function loadFull(evals: PositionEval[]): void {
    resetFull();
    view.full.evals = evals;
    view.full.done = evals.length;
    view.full.total = evals.length;
  }

  function cancelFull(): void {
    abort?.abort();
    engine?.stop();
  }

  function setEnabled(on: boolean): void {
    view.enabled = on;
    view.autoOff = false;
    writeEnabled(on);
    if (!on) {
      cancelFull();
      clearLive();
      engine?.dispose(); // frees the worker and its memory
      engine = null;
      view.status = "off";
    } else {
      void ensureEngine();
    }
  }

  function dispose(): void {
    cancelFull();
    engine?.dispose();
    engine = null;
  }

  return {
    get view() { return view; },
    ensureEngine,
    analysePosition,
    clearLive,
    runFull,
    resetFull,
    loadFull,
    cancelFull,
    setEnabled,
    dispose,
  };
}

export type AnalysisSession = ReturnType<typeof createAnalysisSession>;
