import { describe, expect, it } from "vitest";
import {
  acceptTakeback, canOfferTakeback, declineTakeback, offerTakeback,
} from "./actions.js";
import { applyMove } from "./applyMove.js";
import { FIRST_MOVE_WINDOW_MS } from "./clock.js";
import { createGame } from "./createGame.js";
import type { GameState } from "./types.js";

const CLOCK = { mode: "live" as const, initialMs: 60_000, incrementMs: 0 };

// Plays moves one second apart starting at t=0.
function play(moves: string[]): GameState {
  let state = createGame({ clock: CLOCK, now: 0 });
  let now = 0;
  for (const uci of moves) {
    const res = applyMove(state, uci, now);
    if (!res.ok) throw new Error(`${uci}: ${res.error}`);
    state = res.state;
    now += 1_000;
  }
  return state;
}

function offered(state: GameState, by: "white" | "black"): GameState {
  const res = offerTakeback(state, by);
  if (!res.ok) throw new Error(res.error);
  return res.state;
}

describe("offerTakeback", () => {
  it("is refused before the requester has moved", () => {
    const fresh = play([]);
    expect(canOfferTakeback(fresh, "white")).toBe(false);
    expect(offerTakeback(fresh, "white")).toEqual({ ok: false, error: "nothing_to_take_back" });

    const afterWhite = play(["e2e4"]);
    expect(canOfferTakeback(afterWhite, "black")).toBe(false);
    expect(offerTakeback(afterWhite, "black").ok).toBe(false);
    expect(canOfferTakeback(afterWhite, "white")).toBe(true);
  });

  it("allows only one pending offer", () => {
    const state = offered(play(["e2e4"]), "white");
    expect(offerTakeback(state, "white")).toEqual({ ok: false, error: "takeback_already_offered" });
    expect(canOfferTakeback(state, "white")).toBe(false);
  });
});

describe("acceptTakeback", () => {
  it("undoes one ply when the requester just moved", () => {
    const state = offered(play(["e2e4"]), "white");
    const res = acceptTakeback(state, "black", 5_000);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.moves).toEqual([]);
    expect(res.state.ply).toBe(0);
    expect(res.state.turn).toBe("white");
    expect(res.state.takebackOfferedBy).toBeUndefined();
    expect(res.state.deadlineAt).toBe(5_000 + FIRST_MOVE_WINDOW_MS); // back in the first-move window
  });

  it("undoes two plies when the opponent has already replied (white requests)", () => {
    const state = offered(play(["e2e4", "e7e5"]), "white");
    const res = acceptTakeback(state, "black", 5_000);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.moves).toEqual([]);
    expect(res.state.turn).toBe("white");
  });

  it("undoes two plies when black requests after white has moved again", () => {
    const state = offered(play(["e2e4", "e7e5", "g1f3"]), "black");
    const res = acceptTakeback(state, "white", 5_000);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.moves).toEqual(["e2e4"]);
    expect(res.state.ply).toBe(1);
    expect(res.state.turn).toBe("black");
  });

  it("restarts the requester's clock without refunding time (opponent had replied)", () => {
    // moves at t=0,1000,2000,3000 → ply 4, white to move, both sides at 59_000, deadline 62_000
    const state = offered(play(["e2e4", "e7e5", "g1f3", "b8c6"]), "white");
    const res = acceptTakeback(state, "black", 10_000);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.moves).toEqual(["e2e4", "e7e5"]);
    expect(res.state.turn).toBe("white");
    expect(res.state.whiteMs).toBe(52_000); // 62_000 - 10_000: white kept running meanwhile
    expect(res.state.blackMs).toBe(59_000);
    expect(res.state.turnStartedAt).toBe(10_000);
    expect(res.state.deadlineAt).toBe(62_000);
  });

  it("charges the opponent's thinking time when the requester just moved", () => {
    // ply 3, black to move: white 59_000, black 60_000, deadline 62_000
    const state = offered(play(["e2e4", "e7e5", "g1f3"]), "white");
    const res = acceptTakeback(state, "black", 5_000);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.moves).toEqual(["e2e4", "e7e5"]);
    expect(res.state.turn).toBe("white");
    expect(res.state.whiteMs).toBe(59_000);
    expect(res.state.blackMs).toBe(57_000); // 62_000 - 5_000
    expect(res.state.deadlineAt).toBe(64_000); // 5_000 + white's 59_000
  });

  it("cannot be accepted by the requester or without an offer", () => {
    const state = offered(play(["e2e4"]), "white");
    expect(acceptTakeback(state, "white", 5_000)).toEqual({ ok: false, error: "no_takeback_to_accept" });
    expect(acceptTakeback(play(["e2e4"]), "black", 5_000)).toEqual({ ok: false, error: "no_takeback_to_accept" });
  });

  it("is refused once the deadline has passed", () => {
    const state = offered(play(["e2e4", "e7e5", "g1f3", "b8c6"]), "white");
    expect(acceptTakeback(state, "black", 70_000)).toEqual({ ok: false, error: "deadline_passed" });
  });
});

describe("declining and superseding", () => {
  it("decline clears the offer; the requester can't decline their own", () => {
    const state = offered(play(["e2e4"]), "white");
    expect(declineTakeback(state, "white")).toEqual({ ok: false, error: "cannot_decline_own_offer" });
    const res = declineTakeback(state, "black");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.takebackOfferedBy).toBeUndefined();
    expect(res.state.ply).toBe(1);
  });

  it("playing a move clears a pending offer", () => {
    const state = offered(play(["e2e4"]), "white");
    const res = applyMove(state, "e7e5", 2_000);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.takebackOfferedBy).toBeUndefined();
  });
});