import { describe, expect, it } from "vitest";
import { buildChart, niceStep, type ChartBox, type ChartPoint } from "./ratingChart";

const BOX: ChartBox = { width: 400, height: 200, left: 40, right: 10, top: 10, bottom: 20 };
const pt = (createdAt: number, rating: number): ChartPoint => ({ gameId: `g${createdAt}`, createdAt, rating });

describe("niceStep", () => {
  it("picks the smallest step that fits in four gridlines", () => {
    expect(niceStep(20)).toBe(5);
    expect(niceStep(100)).toBe(25);
    expect(niceStep(380)).toBe(100);
  });
});

describe("buildChart", () => {
  it("returns an empty chart when nothing is in the window", () => {
    const g = buildChart([pt(5, 1500)], BOX, { start: 10, end: 20 });
    expect(g.path).toBe("");
    expect(g.dots).toEqual([]);
    expect(g.yTicks).toEqual([]);
  });

  it("maps time left-to-right and higher ratings higher up", () => {
    const g = buildChart([pt(0, 1500), pt(50, 1600), pt(100, 1550)], BOX, { start: 0, end: 100 });
    expect(g.dots[0]!.x).toBe(BOX.left);
    expect(g.dots[2]!.x).toBe(BOX.width - BOX.right);
    expect(g.dots[1]!.y).toBeLessThan(g.dots[0]!.y); // 1600 is above 1500 (smaller y)
    expect(g.path.startsWith("M")).toBe(true);
    expect(g.path.split("L")).toHaveLength(3);
  });

  it("ignores points outside the domain", () => {
    const g = buildChart([pt(-5, 1000), pt(10, 1500), pt(500, 2000)], BOX, { start: 0, end: 100 });
    expect(g.dots.map((d) => d.point.rating)).toEqual([1500]);
  });

  it("handles a single point and a flat line without dividing by zero", () => {
    const one = buildChart([pt(10, 1500)], BOX, { start: 10, end: 10 });
    expect(one.dots).toHaveLength(1);
    expect(Number.isFinite(one.dots[0]!.x) && Number.isFinite(one.dots[0]!.y)).toBe(true);
    const flat = buildChart([pt(0, 1500), pt(10, 1500)], BOX, { start: 0, end: 10 });
    expect(flat.yTicks.length).toBeGreaterThan(1);
    expect(flat.dots.every((d) => Number.isFinite(d.y))).toBe(true);
  });

  it("keeps every dot inside the plot area and brackets the data with ticks", () => {
    const g = buildChart([pt(0, 1480), pt(1, 1733), pt(2, 1602)], BOX, { start: 0, end: 2 });
    for (const d of g.dots) {
      expect(d.y).toBeGreaterThanOrEqual(BOX.top);
      expect(d.y).toBeLessThanOrEqual(BOX.height - BOX.bottom);
    }
    expect(g.yTicks[0]!.value).toBeLessThanOrEqual(1480);
    expect(g.yTicks.at(-1)!.value).toBeGreaterThanOrEqual(1733);
  });
});
