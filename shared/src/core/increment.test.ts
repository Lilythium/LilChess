import { describe, expect, it } from "vitest";
import { applyMove } from "./applyMove.js";
import { createGame } from "./createGame.js";
import type { ClockConfig, GameState } from "./types.js";

const INC: ClockConfig = { mode: "live", initialMs: 60_000, incrementMs: 2_000 };
const NO_INC: ClockConfig = { mode: "live", initialMs: 60_000, incrementMs: 0 };

function playAt(moves: [string, number][], clock: ClockConfig = INC): GameState {
  let state = createGame({ clock, now: 0 });
  for (const [uci, at] of moves) {
    const res = applyMove(state, uci, at);
    if (!res.ok) throw new Error(`${uci}@${at}: ${res.error}`);
    state = res.state;
  }
  return state;
}

const OPENING: [string, number][] = [["e2e4", 0], ["e7e5", 1_000]];

describe("increment", () => {
  it("is not added on either side's first move", () => {
    const s = playAt(OPENING);
    expect(s.whiteMs).toBe(60_000);
    expect(s.blackMs).toBe(60_000);
  });

  it("is added to white's second move", () => {
    const s = playAt([...OPENING, ["g1f3", 4_000]]); // 3s elapsed
    expect(s.whiteMs).toBe(59_000); // 60000 - 3000 + 2000
    expect(s.blackMs).toBe(60_000);
    expect(s.turnStartedAt).toBe(4_000);
    expect(s.deadlineAt).toBe(64_000); // now + black's full time
  });

  it("is added to black's second move", () => {
    const s = playAt([...OPENING, ["g1f3", 4_000], ["b8c6", 10_000]]); // black used 6s
    expect(s.blackMs).toBe(56_000); // 60000 - 6000 + 2000
    expect(s.whiteMs).toBe(59_000);
    expect(s.deadlineAt).toBe(69_000); // now + white's time
  });

  it("can lift a clock above its starting time", () => {
    const s = playAt([...OPENING, ["g1f3", 1_000]]); // instant reply
    expect(s.whiteMs).toBe(62_000);
  });

  it("keeps accumulating across move cycles", () => {
    // white thinks exactly 2s on the third move: net zero
    const s = playAt([...OPENING, ["g1f3", 4_000], ["b8c6", 10_000], ["f1c4", 12_000]]);
    expect(s.whiteMs).toBe(59_000);
    expect(s.blackMs).toBe(56_000);
    expect(s.deadlineAt).toBe(68_000);
  });

  it("does not rescue a move that arrives at or after the deadline", () => {
    const running = playAt(OPENING); // white's deadline: 61_000
    const late = applyMove(running, "g1f3", 61_000);
    expect(late.ok).toBe(true);
    if (!late.ok) return;
    expect(late.state.status).toBe("finished");
    expect(late.state.termination).toBe("timeout");
    expect(late.state.result).toBe("0-1");
    expect(late.state.moves).toEqual(["e2e4", "e7e5"]);

    const justInTime = applyMove(running, "g1f3", 60_999);
    expect(justInTime.ok).toBe(true);
    if (!justInTime.ok) return;
    expect(justInTime.state.status).toBe("started");
    expect(justInTime.state.whiteMs).toBe(2_001); // 1ms left + 2000 increment
  });

  it("zero increment just spends time", () => {
    const s = playAt([...OPENING, ["g1f3", 4_000]], NO_INC);
    expect(s.whiteMs).toBe(57_000);
  });
});