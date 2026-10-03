import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyMove } from "@lilchess/shared";
import { hasResumableLocalGame, saveLocalGame, startLocalGame } from "./localGame";

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});

describe("hasResumableLocalGame", () => {
  it("is false with nothing saved", () => {
    expect(hasResumableLocalGame()).toBe(false);
  });

  it("is false for a fresh game with no moves", () => {
    startLocalGame({ minutes: 5, incrementSec: 0 });
    expect(hasResumableLocalGame()).toBe(false);
  });

  it("is true once a move has been played", () => {
    const save = startLocalGame({ minutes: 5, incrementSec: 0 });
    const res = applyMove(save.game, "e2e4", Date.now());
    if (!res.ok) throw new Error(res.error);
    saveLocalGame({ ...save, game: res.state });
    expect(hasResumableLocalGame()).toBe(true);
  });

  it("is false for finished games and for clocks that ran out while away", () => {
    const save = startLocalGame({ minutes: 5, incrementSec: 0 });
    saveLocalGame({ ...save, game: { ...save.game, ply: 2, status: "finished" } });
    expect(hasResumableLocalGame()).toBe(false);

    saveLocalGame({ ...save, game: { ...save.game, ply: 2, deadlineAt: Date.now() - 1 } });
    expect(hasResumableLocalGame()).toBe(false);
  });
});