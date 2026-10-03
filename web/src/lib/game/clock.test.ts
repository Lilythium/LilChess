import { describe, expect, it } from "vitest";
import { createGame, type GameState } from "@lilchess/shared";
import {
  remainingMs,
  getLowTimeThreshold,
  crossedLowTimeThreshold,
} from "./clock";

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

describe("getLowTimeThreshold", () => {
  it("uses half the starting time below 1 minute", () => {
    expect(getLowTimeThreshold(30_000)).toBe(15_000);
    expect(getLowTimeThreshold(59_000)).toBe(29_500);
  });

  it("uses 30 seconds from 1 minute to below 2 minutes", () => {
    expect(getLowTimeThreshold(60_000)).toBe(30_000);
    expect(getLowTimeThreshold(90_000)).toBe(30_000);
    expect(getLowTimeThreshold(119_999)).toBe(30_000);
  });

  it("uses 60 seconds from 2 minutes through 5 minutes", () => {
    expect(getLowTimeThreshold(120_000)).toBe(60_000);
    expect(getLowTimeThreshold(180_000)).toBe(60_000);
    expect(getLowTimeThreshold(300_000)).toBe(60_000);
  });

  it("uses one-tenth of the starting time over 5 minutes", () => {
    expect(getLowTimeThreshold(300_001)).toBe(30_000.1);
    expect(getLowTimeThreshold(600_000)).toBe(60_000);
  });
});

describe("crossedLowTimeThreshold", () => {
  it("triggers when crossing the threshold", () => {
    expect(
      crossedLowTimeThreshold(300_000, 61_000, 60_000),
    ).toBe(true);
  });

  it("does not trigger when already below the threshold", () => {
    expect(
      crossedLowTimeThreshold(300_000, 60_000, 59_000),
    ).toBe(false);
  });

  it("does not trigger when still above the threshold", () => {
    expect(
      crossedLowTimeThreshold(300_000, 62_000, 61_000),
    ).toBe(false);
  });
});