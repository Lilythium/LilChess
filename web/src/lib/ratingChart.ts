/** Pure geometry for the profile rating graph, so the Svelte component only draws what this returns. */

export interface ChartPoint {
  gameId: string;
  createdAt: number;
  rating: number;
}

export interface ChartBox {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface ChartGeometry {
  /** SVG path for the rating line; empty when there are no points. */
  path: string;
  dots: { x: number; y: number; point: ChartPoint }[];
  yTicks: { y: number; value: number }[];
  /** First and last x of the time domain, for axis labels. */
  xStart: { x: number; time: number };
  xEnd: { x: number; time: number };
}

const STEPS = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];

/** Smallest "nice" step that gives at most `maxTicks` gridlines across `span`. */
export function niceStep(span: number, maxTicks = 4): number {
  return STEPS.find((s) => span / s <= maxTicks) ?? STEPS[STEPS.length - 1]!;
}

/**
 * Lays out points on a time (x) / rating (y) plane.
 * `domain` is the time window to show; points outside it are ignored.
 */
export function buildChart(points: ChartPoint[], box: ChartBox, domain: { start: number; end: number }): ChartGeometry {
  const innerW = box.width - box.left - box.right;
  const innerH = box.height - box.top - box.bottom;
  const inWindow = points.filter((p) => p.createdAt >= domain.start && p.createdAt <= domain.end);

  const xSpan = domain.end - domain.start;
  const xOf = (t: number) => (xSpan <= 0 ? box.left + innerW / 2 : box.left + ((t - domain.start) / xSpan) * innerW);
  const xStart = { x: box.left, time: domain.start };
  const xEnd = { x: box.left + innerW, time: domain.end };

  if (inWindow.length === 0) return { path: "", dots: [], yTicks: [], xStart, xEnd };

  const ratings = inWindow.map((p) => p.rating);
  let lo = Math.min(...ratings);
  let hi = Math.max(...ratings);
  const step = niceStep(Math.max(hi - lo, 20));
  lo = Math.floor((lo - step * 0.25) / step) * step;
  hi = Math.ceil((hi + step * 0.25) / step) * step;
  if (hi === lo) hi = lo + step;

  const yOf = (r: number) => box.top + (1 - (r - lo) / (hi - lo)) * innerH;
  const dots = inWindow.map((point) => ({ x: xOf(point.createdAt), y: yOf(point.rating), point }));
  const path = dots.map((d, i) => `${i === 0 ? "M" : "L"}${d.x.toFixed(1)},${d.y.toFixed(1)}`).join(" ");

  const yTicks: ChartGeometry["yTicks"] = [];
  for (let v = lo; v <= hi; v += step) yTicks.push({ value: v, y: yOf(v) });

  return { path, dots, yTicks, xStart, xEnd };
}
