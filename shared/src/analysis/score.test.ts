import { describe, expect, it } from "vitest";
import { formatScore, toWhite, winPercent } from "./score.js";

describe("toWhite", () => {
  it("flips the sign when Black is to move", () => {
    expect(toWhite({ kind: "cp", cp: 120 }, "black")).toEqual({ kind: "cp", cp: -120 });
    expect(toWhite({ kind: "mate", moves: 3 }, "black")).toEqual({ kind: "mate", moves: -3 });
  });
  it("keeps the sign when White is to move", () => {
    expect(toWhite({ kind: "cp", cp: 120 }, "white")).toEqual({ kind: "cp", cp: 120 });
  });
});

describe("winPercent", () => {
  it("is 50 for an equal position and symmetric", () => {
    expect(winPercent({ kind: "cp", cp: 0 })).toBeCloseTo(50, 5);
    const up = winPercent({ kind: "cp", cp: 250 });
    const down = winPercent({ kind: "cp", cp: -250 });
    expect(up + down).toBeCloseTo(100, 5);
    expect(up).toBeGreaterThan(50);
  });
  it("clamps huge centipawn scores", () => {
    expect(winPercent({ kind: "cp", cp: 5000 })).toBeCloseTo(winPercent({ kind: "cp", cp: 1000 }), 8);
  });
  it("treats mates and checkmate as decided", () => {
    expect(winPercent({ kind: "mate", moves: 4 })).toBe(100);
    expect(winPercent({ kind: "mate", moves: -4 })).toBe(0);
    expect(winPercent({ kind: "checkmate", winner: "black" })).toBe(0);
  });
});

describe("formatScore", () => {
  it("formats pawns with an explicit sign", () => {
    expect(formatScore({ kind: "cp", cp: 35 })).toBe("+0.35");
    expect(formatScore({ kind: "cp", cp: -120 })).toBe("-1.20");
    expect(formatScore({ kind: "cp", cp: 0 })).toBe("0.00");
    expect(formatScore({ kind: "cp", cp: -0 })).toBe("0.00");
  });
  it("formats mates and results", () => {
    expect(formatScore({ kind: "mate", moves: 3 })).toBe("#3");
    expect(formatScore({ kind: "mate", moves: -2 })).toBe("#-2");
    expect(formatScore({ kind: "checkmate", winner: "white" })).toBe("1-0");
  });
});
