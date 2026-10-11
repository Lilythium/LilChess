import { describe, expect, it } from "vitest";
import { averageAccuracy, gameAccuracy, moveAccuracy } from "./accuracy.js";
import type { MoveVerdict } from "./classify.js";

describe("moveAccuracy", () => {
  it("is 100 for a lossless move and falls as the loss grows", () => {
    expect(moveAccuracy(0)).toBeCloseTo(100, 3);
    expect(moveAccuracy(10)).toBeCloseTo(63.6, 0);
    expect(moveAccuracy(10)).toBeGreaterThan(moveAccuracy(30));
    expect(moveAccuracy(30)).toBeGreaterThan(moveAccuracy(80));
  });
  it("stays within 0..100 and ignores negative loss", () => {
    expect(moveAccuracy(-5)).toBeCloseTo(100, 3);
    expect(moveAccuracy(100)).toBeGreaterThanOrEqual(0);
    expect(moveAccuracy(100)).toBeLessThan(5);
  });
});

describe("averageAccuracy", () => {
  it("is null with no moves", () => {
    expect(averageAccuracy([])).toBeNull();
  });
  it("equals the value when every move is equal", () => {
    expect(averageAccuracy([80, 80, 80])).toBeCloseTo(80, 8);
  });
  it("punishes a single disaster harder than a plain average would", () => {
    const withBlunder = averageAccuracy([100, 100, 100, 100, 0])!;
    expect(withBlunder).toBeLessThan(80); // plain average is 80
    expect(withBlunder).toBeGreaterThan(0);
  });
  it("survives zero accuracies (no divide by zero)", () => {
    expect(Number.isFinite(averageAccuracy([0, 0])!)).toBe(true);
  });
});

describe("gameAccuracy", () => {
  const v = (cls: MoveVerdict["cls"], loss: number): MoveVerdict => ({ cls, loss });

  it("splits plies by side and skips unevaluated ones", () => {
    const out = gameAccuracy([v("best", 0), v("blunder", 60), undefined, v("good", 3)]);
    expect(out.white!).toBeCloseTo(100, 3); // ply 1 only; ply 3 not evaluated
    expect(out.black!).toBeLessThan(out.white!);
  });
  it("does not penalise the engine's own move for eval noise", () => {
    expect(gameAccuracy([v("best", 4)]).white!).toBeCloseTo(100, 3);
  });
  it("is null for a side with no moves", () => {
    expect(gameAccuracy([v("best", 0)]).black).toBeNull();
    expect(gameAccuracy([])).toEqual({ white: null, black: null });
  });
});
