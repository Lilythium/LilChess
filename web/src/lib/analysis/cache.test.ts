import { describe, expect, it } from "vitest";
import type { PositionEval } from "@lilchess/shared";
import { AnalysisCache, ENGINE_ID, type StoreLike } from "./cache";
import { gameCacheKey, type LoadedGame } from "./loadedGame";

function memoryStore(quota = Infinity): StoreLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  const size = () => [...data.values()].reduce((n, v) => n + v.length, 0);
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem(k, v) {
      const before = data.get(k)?.length ?? 0;
      if (size() - before + v.length > quota) throw new Error("QuotaExceededError");
      data.set(k, v);
    },
    removeItem: (k) => void data.delete(k),
  };
}

const evals: PositionEval[] = [
  { score: { kind: "cp", cp: 25 }, best: "e2e4", depth: 14 },
  { score: { kind: "mate", moves: -3 }, best: "d8h4", depth: 14 },
  { score: { kind: "checkmate", winner: "black" }, best: null, depth: 0 },
];

describe("AnalysisCache", () => {
  it("round-trips every kind of score", () => {
    const cache = new AnalysisCache(memoryStore());
    expect(cache.save("g1", 14, evals)).toBe(true);
    expect(cache.load("g1", 3)).toEqual({ depth: 14, evals });
  });

  it("misses for unknown keys and for a different number of positions", () => {
    const cache = new AnalysisCache(memoryStore());
    cache.save("g1", 14, evals);
    expect(cache.load("nope", 3)).toBeNull();
    expect(cache.load("g1", 4)).toBeNull();
  });

  it("refuses to save an incomplete run", () => {
    const cache = new AnalysisCache(memoryStore());
    expect(cache.save("g1", 14, [evals[0], undefined, evals[2]])).toBe(false);
    expect(cache.save("g1", 14, [])).toBe(false);
    expect(cache.load("g1", 3)).toBeNull();
  });

  it("ignores entries written by another engine version", () => {
    const store = memoryStore();
    const cache = new AnalysisCache(store);
    cache.save("g1", 14, evals);
    const key = [...store.data.keys()].find((k) => k.endsWith("g1"))!;
    store.data.set(key, store.data.get(key)!.replace(ENGINE_ID, "sf99"));
    expect(cache.load("g1", 3)).toBeNull();
  });

  it("returns null for corrupt entries instead of throwing", () => {
    const store = memoryStore();
    const cache = new AnalysisCache(store);
    cache.save("g1", 14, evals);
    const key = [...store.data.keys()].find((k) => k.endsWith("g1"))!;
    store.data.set(key, "{not json");
    expect(cache.load("g1", 3)).toBeNull();
    store.data.set(key, JSON.stringify({ e: ENGINE_ID, d: 14, p: [[9, 0, "", 0], [0, 0, "", 0], [0, 0, "", 0]] }));
    expect(cache.load("g1", 3)).toBeNull();
  });

  it("evicts the oldest entries past the limit", () => {
    let t = 0;
    const store = memoryStore();
    const cache = new AnalysisCache(store, () => ++t);
    for (let i = 0; i < 35; i++) cache.save(`g${i}`, 10, evals);
    expect(cache.load("g0", 3)).toBeNull();
    expect(cache.load("g4", 3)).toBeNull();
    expect(cache.load("g5", 3)).not.toBeNull();
    expect(cache.load("g34", 3)).not.toBeNull();
  });

  it("re-saving a game refreshes it rather than duplicating it", () => {
    let t = 0;
    const cache = new AnalysisCache(memoryStore(), () => ++t);
    for (let i = 0; i < 30; i++) cache.save(`g${i}`, 10, evals);
    cache.save("g0", 12, evals); // g0 becomes the newest
    cache.save("new", 10, evals); // pushes out g1, not g0
    expect(cache.load("g0", 3)?.depth).toBe(12);
    expect(cache.load("g1", 3)).toBeNull();
  });

  it("frees space and retries when the store is full, and gives up quietly if it still can't", () => {
    const one = JSON.stringify({ e: ENGINE_ID, d: 10, p: evals.map(() => [0, 0, "e2e4", 10]) }).length;
    const store = memoryStore(one * 3 + 400);
    const cache = new AnalysisCache(store);
    for (let i = 0; i < 6; i++) expect(cache.save(`g${i}`, 10, evals)).toBe(true);
    expect(cache.load("g5", 3)).not.toBeNull();

    expect(new AnalysisCache(memoryStore(10)).save("x", 10, evals)).toBe(false);
  });

  it("does nothing without a store (storage blocked)", () => {
    const cache = new AnalysisCache(null);
    expect(cache.save("g1", 10, evals)).toBe(false);
    expect(cache.load("g1", 3)).toBeNull();
  });
});

describe("gameCacheKey", () => {
  const game: LoadedGame = {
    variant: "standard", initialFen: "start", moves: ["e2e4", "e7e5"],
    white: null, black: null, result: null, termination: null,
  };
  it("keys stored games by id and move count", () => {
    expect(gameCacheKey("abc", game)).toBe("game:abc:2");
  });
  it("keys pasted games by content", () => {
    const a = gameCacheKey(undefined, game);
    expect(a).toBe(gameCacheKey(undefined, { ...game, white: "Someone" }));
    expect(a).not.toBe(gameCacheKey(undefined, { ...game, moves: ["e2e4"] }));
    expect(a).not.toBe(gameCacheKey(undefined, { ...game, variant: "chess960" }));
  });
});
