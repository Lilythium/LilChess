import { describe, expect, it } from "vitest";
import { applyMove } from "./applyMove.js";
import { claimTimeout } from "./actions.js";
import { FIRST_MOVE_WINDOW_MS } from "./clock.js";
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
  it("charges nothing and adds no increment for each side's first move", () => {
    const game = createGame({ clock: LIVE_CLOCK, now: 0 });
    const afterWhite = applyMove(game, "e2e4", 5_000);
    expect(afterWhite.ok).toBe(true);
    if (!afterWhite.ok) return;
    expect(afterWhite.state.whiteMs).toBe(60_000);
    expect(afterWhite.state.deadlineAt).toBe(5_000 + FIRST_MOVE_WINDOW_MS);

    const afterBlack = applyMove(afterWhite.state, "e7e5", 12_000);
    expect(afterBlack.ok).toBe(true);
    if (!afterBlack.ok) return;
    expect(afterBlack.state.blackMs).toBe(60_000);
    expect(afterBlack.state.turnStartedAt).toBe(12_000);
    expect(afterBlack.state.deadlineAt).toBe(72_000); // clock starts: 12_000 + white's full 60_000
  });

  it("starts charging time from white's second move and adds increment", () => {
    const game = createGame({ clock: LIVE_CLOCK, now: 0 });
    const running = play(game, ["e2e4", "e7e5"], 0, 12_000); // black moved at 12_000
    const res = applyMove(running, "g1f3", 17_000); // 5s elapsed
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.whiteMs).toBe(57_000); // 60000 - 5000 + 2000
    expect(res.state.deadlineAt).toBe(77_000); // now(17000) + black's 60000
  });

  it("ends the game on time instead of applying a late move once the clock runs", () => {
    const shortClock = { mode: "live" as const, initialMs: 1_000, incrementMs: 0 };
    const running = play(createGame({ clock: shortClock, now: 0 }), ["e2e4", "e7e5"], 0); // deadline 2000
    const res = applyMove(running, "g1f3", 3_000); // arrives late
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.status).toBe("finished");
    expect(res.state.result).toBe("0-1");
    expect(res.state.termination).toBe("timeout");
    expect(res.state.moves).toEqual(["e2e4", "e7e5"]); // the late move was never recorded
    expect(res.state.whiteMs).toBe(0);
  });

  it("leaves first-move deadlines to the scheduler", () => {
    const game = createGame({ clock: LIVE_CLOCK, now: 0 });
    const res = applyMove(game, "e2e4", FIRST_MOVE_WINDOW_MS + 20_000);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.status).toBe("started");
    expect(res.state.moves).toEqual(["e2e4"]);
  });
});

describe("claimTimeout", () => {
  it("finishes a game whose deadline has passed once the clock runs", () => {
    const running = play(createGame({ clock: LIVE_CLOCK, now: 0 }), ["e2e4", "e7e5"], 0); // deadline 61_000
    const res = claimTimeout(running, 62_000);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.result).toBe("0-1"); // white was to move and flagged
    expect(res.state.termination).toBe("timeout");
    expect(res.state.whiteMs).toBe(0);
  });

  it("refuses to claim before the deadline", () => {
    const running = play(createGame({ clock: LIVE_CLOCK, now: 0 }), ["e2e4", "e7e5"], 0);
    expect(claimTimeout(running, 30_000).ok).toBe(false);
  });

  it("aborts instead of flagging while the first-move window is open", () => {
    const game = createGame({ clock: LIVE_CLOCK, now: 0 });
    expect(claimTimeout(game, FIRST_MOVE_WINDOW_MS - 1).ok).toBe(false);
    const res = claimTimeout(game, FIRST_MOVE_WINDOW_MS + 1);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.status).toBe("aborted");
    expect(res.state.termination).toBe("abort");
    expect(res.state.result).toBeUndefined();
  });
});