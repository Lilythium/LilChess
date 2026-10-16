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

describe("local first-move timing", () => {
  it("allows the first move after the initial deadline", () => {
    const save = startLocalGame({ minutes: 5, incrementSec: 0 });

    const result = applyMove(save.game, "e2e4", save.game.deadlineAt + 1);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.state.ply).toBe(1);
    expect(result.state.status).toBe("started");
  });

  it("allows Black's first move past its deadline, then enforces the clock", () => {
    const save = startLocalGame({ minutes: 5, incrementSec: 0 });
    const whiteMove = applyMove(save.game, "e2e4", save.game.deadlineAt);
    if (!whiteMove.ok) throw new Error(whiteMove.error);

    const blackMove = applyMove(
      whiteMove.state,
      "e7e5",
      whiteMove.state.deadlineAt + 1,
    );

    expect(blackMove.ok).toBe(true);
    if (!blackMove.ok) throw new Error(blackMove.error);
    expect(blackMove.state.ply).toBe(2);
    expect(blackMove.state.status).toBe("started");

    const lateMove = applyMove(blackMove.state, "g1f3", blackMove.state.deadlineAt);

    expect(lateMove.ok).toBe(true);
    if (!lateMove.ok) throw new Error(lateMove.error);
    expect(lateMove.state.ply).toBe(2);
    expect(lateMove.state.status).toBe("finished");
    expect(lateMove.state.termination).toBe("timeout");
  });
});