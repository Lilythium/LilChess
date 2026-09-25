import { describe, expect, it } from "vitest";
import { applyMove } from "./applyMove.js";
import { claimTimeout } from "./actions.js";
import { createGame } from "./createGame.js";
import type { GameState } from "./types.js";

const LIVE_CLOCK = { mode: "live" as const, initialMs: 60_000, incrementMs: 2_000 };

function play(game: GameState, moves: string[], startAt: number, stepMs = 1000) {
  let state = game;
  let now = startAt;
  for (const uci of moves) {
    const res = applyMove(state, uci, now);
    if (!res.ok) throw new Error(`unexpected error on ${uci}: ${res.error}`);
    state = res.state;
    now += stepMs;
  }
  return state;
}

describe("applyMove — game endings", () => {
  it("detects scholar's mate", () => {
    const game = createGame({ clock: LIVE_CLOCK, now: 0 });
    // 1.e4 e5 2.Bc4 Nc6 3.Qh5 Nf6?? 4.Qxf7#
    const moves = ["e2e4", "e7e5", "f1c4", "b8c6", "d1h5", "g8f6", "h5f7"];
    const final = play(game, moves, 0);
    expect(final.status).toBe("finished");
    expect(final.result).toBe("1-0");
    expect(final.termination).toBe("checkmate");
  });

    it("detects stalemate", () => {
    const game: GameState = {
      ...createGame({ clock: LIVE_CLOCK, now: 0 }),
      initialFen: "k7/2Q5/8/8/8/8/8/7K w - - 0 1",
    };
    const res = applyMove(game, "c7b6", 1000);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.status).toBe("finished");
    expect(res.state.result).toBe("1/2-1/2");
    expect(res.state.termination).toBe("stalemate");
  });

  it("detects threefold repetition", () => {
    const game = createGame({ clock: LIVE_CLOCK, now: 0 });
    const moves = [
      "g1f3", "g8f6", "f3g1", "f6g8",
      "g1f3", "g8f6", "f3g1", "f6g8",
    ];
    const final = play(game, moves, 0);
    expect(final.status).toBe("finished");
    expect(final.result).toBe("1/2-1/2");
    expect(final.termination).toBe("repetition");
  });
});

describe("applyMove — clocks", () => {
  it("adds increment after a normal move", () => {
    const game = createGame({ clock: LIVE_CLOCK, now: 0 });
    const res = applyMove(game, "e2e4", 5_000); // 5s elapsed
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.whiteMs).toBe(57_000); // 60000 - 5000 + 2000
    expect(res.state.deadlineAt).toBe(65_000); // now(5000) + black's 60000
  });

  it("ends the game on time instead of applying a late move", () => {
    const shortClock = { mode: "live" as const, initialMs: 1_000, incrementMs: 0 };
    const game = createGame({ clock: shortClock, now: 0 }); // deadline at 1000ms
    const res = applyMove(game, "e2e4", 2_000); // arrives late
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.status).toBe("finished");
    expect(res.state.result).toBe("0-1");
    expect(res.state.termination).toBe("timeout");
    expect(res.state.moves).toEqual([]); // the late move was never recorded
  });
});

describe("claimTimeout", () => {
  it("finishes a game whose deadline has passed", () => {
    const game = createGame({ clock: LIVE_CLOCK, now: 0 });
    const res = claimTimeout(game, 61_000);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.result).toBe("0-1"); // white was to move and flagged
    expect(res.state.termination).toBe("timeout");
  });

  it("refuses to claim before the deadline", () => {
    const game = createGame({ clock: LIVE_CLOCK, now: 0 });
    expect(claimTimeout(game, 30_000).ok).toBe(false);
  });
});