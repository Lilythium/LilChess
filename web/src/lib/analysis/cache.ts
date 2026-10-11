import type { PositionEval, Score } from "@lilchess/shared";

/** Bump when the engine or the evaluation format changes: older entries are then ignored. */
export const ENGINE_ID = "sf18-lite-single";

const ENTRY_PREFIX = "lilchess.analysis.v1:";
const INDEX_KEY = "lilchess.analysis.index";
const MAX_ENTRIES = 30;

export interface StoreLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface CachedAnalysis {
  depth: number;
  evals: PositionEval[];
}

// One position as [scoreKind, scoreValue, bestMove, depth]. kind 0 = cp, 1 = mate, 2 = checkmate (value 1 = White wins).
type Packed = [number, number, string, number];

function pack(e: PositionEval): Packed {
  const { score } = e;
  const [kind, value] =
    score.kind === "cp" ? [0, score.cp]
    : score.kind === "mate" ? [1, score.moves]
    : [2, score.winner === "white" ? 1 : 0];
  return [kind, value, e.best ?? "", e.depth];
}

function unpack(p: unknown): PositionEval | null {
  if (!Array.isArray(p) || p.length !== 4) return null;
  const [kind, value, best, depth] = p;
  if (typeof kind !== "number" || typeof value !== "number" || typeof best !== "string" || typeof depth !== "number") return null;
  let score: Score;
  if (kind === 0) score = { kind: "cp", cp: value };
  else if (kind === 1) score = { kind: "mate", moves: value };
  else if (kind === 2) score = { kind: "checkmate", winner: value === 1 ? "white" : "black" };
  else return null;
  return { score, best: best || null, depth };
}

interface IndexEntry { key: string; at: number }

function readIndex(store: StoreLike): IndexEntry[] {
  try {
    const parsed = JSON.parse(store.getItem(INDEX_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((e): e is IndexEntry => typeof e?.key === "string" && typeof e?.at === "number")
      : [];
  } catch {
    return [];
  }
}

/**
 * Remembers finished full-game analyses in localStorage so reopening a game doesn't
 * re-run the engine. Least-recently-saved entries are evicted past MAX_ENTRIES, and a
 * full or blocked store just means nothing is cached; it never throws.
 */
export class AnalysisCache {
  constructor(private readonly store: StoreLike | null, private readonly now: () => number = Date.now) {}

  /** The cached run for `key`, or null if absent, stale (other engine) or not for `positions` positions. */
  load(key: string, positions: number): CachedAnalysis | null {
    if (!this.store) return null;
    try {
      const raw = this.store.getItem(ENTRY_PREFIX + key);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (data?.e !== ENGINE_ID || typeof data.d !== "number" || !Array.isArray(data.p) || data.p.length !== positions) return null;
      const evals = data.p.map(unpack);
      return evals.every(Boolean) ? { depth: data.d, evals: evals as PositionEval[] } : null;
    } catch {
      return null;
    }
  }

  /** Saves a complete run. Returns false for an incomplete run or when storage refuses. */
  save(key: string, depth: number, evals: (PositionEval | undefined)[]): boolean {
    if (!this.store || evals.length === 0 || !evals.every(Boolean)) return false;
    const value = JSON.stringify({ e: ENGINE_ID, d: depth, p: (evals as PositionEval[]).map(pack) });

    const write = () => {
      this.store!.setItem(ENTRY_PREFIX + key, value);
      const index = readIndex(this.store!).filter((e) => e.key !== key);
      index.unshift({ key, at: this.now() });
      for (const old of index.splice(MAX_ENTRIES)) this.store!.removeItem(ENTRY_PREFIX + old.key);
      this.store!.setItem(INDEX_KEY, JSON.stringify(index));
    };

    try {
      write();
      return true;
    } catch {
      // Probably out of quota: drop the older half and try once more.
      try {
        const index = readIndex(this.store);
        for (const old of index.splice(Math.ceil(index.length / 2))) this.store.removeItem(ENTRY_PREFIX + old.key);
        this.store.setItem(INDEX_KEY, JSON.stringify(index));
        write();
        return true;
      } catch {
        return false;
      }
    }
  }
}

export function browserCache(): AnalysisCache {
  try {
    return new AnalysisCache(localStorage);
  } catch {
    return new AnalysisCache(null); // storage blocked
  }
}
