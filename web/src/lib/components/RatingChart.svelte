<script lang="ts">
  import { buildChart, type ChartBox, type ChartPoint } from "../ratingChart";

  let { points, start, end, loading = false }: {
    points: ChartPoint[];
    /** Time window to draw, in ms. */
    start: number;
    end: number;
    loading?: boolean;
  } = $props();

  const BOX: ChartBox = { width: 640, height: 260, left: 44, right: 12, top: 12, bottom: 26 };

  const geo = $derived(buildChart(points, BOX, { start, end }));
  let hover = $state<number | null>(null);
  const active = $derived(hover === null ? geo.dots.at(-1) : geo.dots[hover]);

  const fmtDate = (t: number) =>
    new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" });

  function onMove(e: PointerEvent) {
    if (geo.dots.length === 0) return;
    const svg = e.currentTarget as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * BOX.width;
    let best = 0;
    for (let i = 1; i < geo.dots.length; i++) {
      if (Math.abs(geo.dots[i]!.x - x) < Math.abs(geo.dots[best]!.x - x)) best = i;
    }
    hover = best;
  }
</script>

<div class="chart">
  {#if loading && points.length === 0}
    <p class="muted empty">Loading…</p>
  {:else if geo.dots.length === 0}
    <p class="muted empty">No rated games in this period.</p>
  {:else}
    <p class="readout" aria-live="polite">
      <strong>{active?.point.rating}</strong>
      <span class="muted">{active ? fmtDate(active.point.createdAt) : ""}</span>
    </p>
    <svg
      viewBox={`0 0 ${BOX.width} ${BOX.height}`}
      role="img"
      aria-label="Rating history graph"
      onpointermove={onMove}
      onpointerleave={() => (hover = null)}
    >
      {#each geo.yTicks as t (t.value)}
        <line x1={BOX.left} x2={BOX.width - BOX.right} y1={t.y} y2={t.y} class="grid" />
        <text x={BOX.left - 6} y={t.y + 4} text-anchor="end" class="axis">{t.value}</text>
      {/each}
      <text x={geo.xStart.x} y={BOX.height - 6} text-anchor="start" class="axis">{fmtDate(geo.xStart.time)}</text>
      <text x={geo.xEnd.x} y={BOX.height - 6} text-anchor="end" class="axis">{fmtDate(geo.xEnd.time)}</text>
      <path d={geo.path} class="line" />
      {#if geo.dots.length <= 60}
        {#each geo.dots as d (d.point.gameId)}<circle cx={d.x} cy={d.y} r="2.5" class="dot" />{/each}
      {/if}
      {#if active}
        <circle cx={active.x} cy={active.y} r="5" class="focus" />
      {/if}
    </svg>
  {/if}
</div>

<style>
  .chart { width: 100%; }
  svg { width: 100%; height: auto; display: block; touch-action: pan-y; }
  .grid { stroke: var(--border); stroke-width: 1; }
  .axis { fill: var(--muted); font-size: 11px; }
  .line { fill: none; stroke: var(--green-hi); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
  .dot { fill: var(--green-hi); }
  .focus { fill: var(--bg); stroke: var(--text-hi); stroke-width: 2; }
  .readout { margin: 0 0 .25rem; display: flex; gap: .6rem; align-items: baseline; }
  .readout strong { font-size: 1.1rem; color: var(--text-hi); }
  .empty { padding: 2.5rem 0; text-align: center; margin: 0; }
</style>
