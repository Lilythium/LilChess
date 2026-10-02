import { describe, expect, it } from "vitest";
import { createGame, type GameState } from "@lilchess/shared";
import { remainingMs } from "./clock";

const clock = { mode: "live" as const, initialMs: 60_000, incrementMs: 0 };

function started(ply: number): GameState {
  return { ...createGame({ clock, now: 0 }), ply, turn: ply % 2 === 0 ? "white" : "black", deadlineAt: 40_000 };
}

describe("remainingMs", () => {
  it("does not tick before both sides have moved", () => {
    expect(remainingMs(started(0), "white", 25_000)).toBe(60_000);
    expect(remainingMs(started(1), "black", 25_000)).toBe(60_000);
  });

  it("derives the mover's time from the deadline once the clock runs", () => {
    expect(remainingMs(started(2), "white", 25_000)).toBe(15_000);
  });

  it("uses the stored value for the waiting side", () => {
    const g = { ...started(2), blackMs: 51_000 };
    expect(remainingMs(g, "black", 25_000)).toBe(51_000);
  });
});