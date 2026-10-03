import { describe, expect, it } from "vitest";
import { acceptTakeback, offerTakeback } from "./actions.js";
import { applyMove } from "./applyMove.js";
import { FIRST_MOVE_WINDOW_MS } from "./clock.js";
import { createGame } from "./createGame.js";
import type { ClockConfig, Color, GameState } from "./types.js";

const LIVE: ClockConfig = { mode: "live", initialMs: 60_000, incrementMs: 0 };
const CORR: ClockConfig = { mode: "correspondence", daysPerMove: 3 };
const DAY = 86_400_000;

// Moves one second apart starting at t=0.
function play(moves: string[], clock: ClockConfig = LIVE): GameState {
  let state = createGame({ clock, now: 0 });
  let now = 0;
  for (const uci of moves) {
    const res = applyMove(state, uci, now);
    if (!res.ok) throw new Error(`${uci}: ${res.error}`);
    state = res.state;
    now += 1_000;
  }
  return state;
}

function offered(state: GameState, by: Color): GameState {
  const res = offerTakeback(state, by);
  if (!res.ok) throw new Error(res.error);
  return res.state;
}

function accepted(state: GameState, by: Color, now: number): GameState {
  const res = acceptTakeback(state, by, now);
  if (!res.ok) throw new Error(res.error);
  return res.state;
}

describe("takeback immediately after a move", () => {
  it("accepted in the same millisecond as the move: opponent's clock keeps running", () => {
    // last move g1f3 at t=2000: white 59_000, black 60_000, deadline 62_000
    const state = offered(play(["e2e4", "e7e5", "g1f3"]), "white");
    const next = accepted(state, "black", 2_000);
    expect(next.moves).toEqual(["e2e4", "e7e5"]);
    expect(next.turn).toBe("white");
    expect(next.whiteMs).toBe(59_000);
    expect(next.blackMs).toBe(60_000);
    expect(next.deadlineAt).toBe(61_000);
  });
});

describe("takeback near flag fall", () => {
  // after 4 plies: white to move, deadline 62_000
  const base = () => offered(play(["e2e4", "e7e5", "g1f3", "b8c6"]), "white");

  it("is still accepted 1ms before the deadline, and no time is refunded", () => {
    const next = accepted(base(), "black", 61_999);
    expect(next.moves).toEqual(["e2e4", "e7e5"]);
    expect(next.turn).toBe("white");
    expect(next.whiteMs).toBe(1);
    expect(next.deadlineAt).toBe(62_000);
  });

  it("is refused at the deadline", () => {
    expect(acceptTakeback(base(), "black", 62_000)).toEqual({ ok: false, error: "deadline_passed" });
  });
});

describe("takeback in correspondence games", () => {
  it("resets the deadline to a full move period and touches no clocks", () => {
    const state = offered(play(["e2e4"], CORR), "white");
    const next = accepted(state, "black", 5_000);
    expect(next.moves).toEqual([]);
    expect(next.turn).toBe("white");
    expect(next.deadlineAt).toBe(5_000 + 3 * DAY);
    expect(next.whiteMs).toBe(0);
    expect(next.blackMs).toBe(0);
  });

  it("undoes two plies when the opponent has replied", () => {
    const state = offered(play(["e2e4", "e7e5"], CORR), "black");
    const next = accepted(state, "white", 5_000);
    expect(next.moves).toEqual(["e2e4"]);
    expect(next.turn).toBe("black");
  });
});

describe("takeback back to ply 1", () => {
  it("black retracts their only move: back in black's first-move window", () => {
    const state = offered(play(["e2e4", "e7e5"]), "black");
    const next = accepted(state, "white", 5_000);
    expect(next.moves).toEqual(["e2e4"]);
    expect(next.ply).toBe(1);
    expect(next.turn).toBe("black");
    expect(next.whiteMs).toBe(60_000);
    expect(next.blackMs).toBe(60_000);
    expect(next.deadlineAt).toBe(5_000 + FIRST_MOVE_WINDOW_MS);
  });
});

describe("takeback when a player has never moved", () => {
  it("is refused for white at the start and for black after only white's move", () => {
    expect(offerTakeback(play([]), "white")).toEqual({ ok: false, error: "nothing_to_take_back" });
    expect(offerTakeback(play(["e2e4"]), "black")).toEqual({ ok: false, error: "nothing_to_take_back" });
  });
});

describe("takeback after multiple move cycles", () => {
  const SIX = ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6"];

  it("removes exactly the requester's last move and the reply", () => {
    const next = accepted(offered(play(SIX), "white"), "black", 10_000);
    expect(next.moves).toEqual(SIX.slice(0, 4));
    expect(next.ply).toBe(4);
    expect(next.turn).toBe("white");
  });

  it("lets the game continue with a different move and be taken back again", () => {
    const back = accepted(offered(play(SIX), "white"), "black", 10_000);

    const res = applyMove(back, "f1b5", 20_000); // bishop is back on f1 after the takeback
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.moves).toEqual([...SIX.slice(0, 4), "f1b5"]);

    const again = accepted(offered(res.state, "white"), "black", 21_000);
    expect(again.moves).toEqual(SIX.slice(0, 4));
    expect(again.turn).toBe("white");
  });
});