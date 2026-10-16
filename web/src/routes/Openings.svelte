<script lang="ts">
  import { onMount } from "svelte";
  import { PositionTimeline, VARIANTS, VARIANT_LABELS, startFenFor, type Color, type Variant } from "@lilchess/shared";
  import { api } from "../lib/api";
  import AnalysisBoard from "../lib/components/AnalysisBoard.svelte";

  type Move = { uci: string; san: string; white: number; draws: number; black: number; total: number };
  type Explorer = { variant: Variant; fen: string; white: number; draws: number; black: number; total: number; moves: Move[] };

  let { variant: variantParam = "standard" }: { variant?: string } = $props();
  const variant = $derived<Variant>(
    (VARIANTS as readonly string[]).includes(variantParam) ? (variantParam as Variant) : "standard",
  );

  let line = $state<string[]>([]);
  let flipped = $state(false);
  let data = $state<Explorer | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(false);
  let seq = 0; // drops answers for a position the user has already left

  const orientation = $derived<Color>(flipped ? "black" : "white");
  // Every position of the line, rebuilt when the variant or the line changes (lines are at most a few dozen plies).
  const timeline = $derived.by(() => {
    try {
      const tl = new PositionTimeline(startFenFor(variant), variant);
      tl.sync(line);
      return tl;
    } catch {
      return null;
    }
  });
  const fen = $derived(timeline?.fens[line.length] ?? startFenFor(variant));
  const lastMove = $derived(timeline?.squares[line.length] ?? null);

  async function load(forVariant: Variant, forFen: string) {
    const mine = ++seq;
    loading = true;
    try {
      const res = await api<Explorer>(`/api/openings?variant=${forVariant}&fen=${encodeURIComponent(forFen)}`);
      if (mine !== seq) return;
      data = res;
      error = null;
    } catch (err) {
      if (mine === seq) error = err instanceof Error ? err.message : String(err);
    } finally {
      if (mine === seq) loading = false;
    }
  }

  $effect(() => {
    void load(variant, fen);
  });

  // Switching variant starts a fresh line.
  let shownVariant: Variant | null = null;
  $effect(() => {
    if (shownVariant !== null && shownVariant !== variant) line = [];
    shownVariant = variant;
  });

  const play = (uci: string) => (line = [...line, uci]);
  const back = () => (line = line.slice(0, -1));
  const reset = () => (line = []);

  const pct = (part: number, whole: number) => (whole === 0 ? 0 : Math.round((100 * part) / whole));
  const moveNumber = (i: number) => (i % 2 === 0 ? `${i / 2 + 1}.` : "");

  function onKey(e: KeyboardEvent) {
    const t = e.target;
    if (t instanceof HTMLElement && ["INPUT", "SELECT", "TEXTAREA"].includes(t.tagName)) return;
    if (e.key === "ArrowLeft") { e.preventDefault(); back(); }
  }

  onMount(() => () => { seq++; });
</script>

<svelte:window onkeydown={onKey} />
<svelte:head><title>Openings</title></svelte:head>

<div class="tabs">
  {#each VARIANTS as v (v)}
    <a href={`#/openings/${v}`} class="tab" class:active={v === variant} aria-current={v === variant ? "page" : undefined}>{VARIANT_LABELS[v]}</a>
  {/each}
</div>

<div class="explorer">
  <div class="board-col">
    <AnalysisBoard {fen} {orientation} {lastMove} {variant} chess960={variant === "chess960"} onMove={play} />
    <div class="controls">
      <button type="button" onclick={back} disabled={line.length === 0}>◀ Back</button>
      <button type="button" onclick={reset} disabled={line.length === 0}>Start</button>
      <button type="button" onclick={() => (flipped = !flipped)}>Flip</button>
    </div>
  </div>

  <div class="side">
    <p class="line" aria-label="Moves played">
      {#if line.length === 0}<span class="muted">Starting position</span>{/if}
      {#each timeline?.sans ?? [] as san, i (i)}<span class="mv"><span class="muted">{moveNumber(i)}</span> {san}</span>{/each}
    </p>

    {#if error}
      <p class="error" role="alert">{error}</p>
    {:else if !data}
      <p class="muted">Loading…</p>
    {:else}
      <div class="panel" class:stale={loading}>
        <h2>
          {#if data.total === 0}No games from here yet{:else}{data.total} game{data.total === 1 ? "" : "s"}{/if}
        </h2>
        {#if data.total > 0}
          <div class="bar total" role="img" aria-label={`White ${pct(data.white, data.total)}%, draws ${pct(data.draws, data.total)}%, Black ${pct(data.black, data.total)}%`}>
            <span class="w" style:width={`${pct(data.white, data.total)}%`}>{pct(data.white, data.total)}%</span>
            <span class="d" style:width={`${pct(data.draws, data.total)}%`}>{pct(data.draws, data.total)}%</span>
            <span class="b" style:width={`${pct(data.black, data.total)}%`}>{pct(data.black, data.total)}%</span>
          </div>
          <div class="table-scroll">
            <table>
              <thead><tr><th>Move</th><th>Games</th><th>White / draw / Black</th></tr></thead>
              <tbody>
                {#each data.moves as m (m.uci)}
                  <tr tabindex="0" onclick={() => play(m.uci)} onkeydown={(e) => { if (e.key === "Enter") play(m.uci); }}>
                    <td class="san">{m.san}</td>
                    <td>{m.total} <span class="muted">({pct(m.total, data.total)}%)</span></td>
                    <td>
                      <div class="bar" aria-hidden="true">
                        <span class="w" style:width={`${pct(m.white, m.total)}%`}></span>
                        <span class="d" style:width={`${pct(m.draws, m.total)}%`}></span>
                        <span class="b" style:width={`${pct(m.black, m.total)}%`}></span>
                      </div>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {:else}
          <p class="muted">Nobody has played on from this position in a finished {VARIANT_LABELS[variant]} game on this server.</p>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .tabs { display: flex; gap: 0.25rem; flex-wrap: wrap; margin-bottom: 1rem; }
  .tab { padding: 0.5rem 0.9rem; border: 1px solid var(--border); background: var(--panel); color: var(--text); min-height: var(--tap); display: inline-flex; align-items: center; }
  .tab.active { border-color: var(--green); color: var(--text-hi); background: var(--panel-hi); }

  .explorer { display: grid; grid-template-columns: minmax(280px, 560px) minmax(0, 1fr); gap: 1.25rem; align-items: start; }
  .board-col { min-width: 0; }
  .controls { display: flex; gap: 0.5rem; margin-top: 0.5rem; flex-wrap: wrap; }
  .side { min-width: 0; display: flex; flex-direction: column; gap: 0.75rem; }
  .line { margin: 0; display: flex; flex-wrap: wrap; gap: 0.2rem 0.5rem; min-height: 1.5rem; }
  .mv { white-space: nowrap; }
  .stale { opacity: 0.6; }
  h2 { margin-top: 0; }

  .bar { display: flex; height: 0.9rem; border-radius: 3px; overflow: hidden; background: var(--panel-hi); min-width: 6rem; }
  .bar.total { height: 1.6rem; margin-bottom: 0.75rem; font-size: 0.8rem; font-weight: 600; }
  .bar span { display: block; overflow: hidden; text-align: center; line-height: 1.6rem; }
  .bar:not(.total) span { line-height: 0.9rem; }
  .w { background: #e8e8e8; color: #222; }
  .d { background: #8a8a8a; color: #fff; }
  .b { background: #3a3a3a; color: #eee; }

  .table-scroll { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 0.4rem 0.5rem; border-bottom: 1px solid var(--border); }
  tbody tr { cursor: pointer; }
  tbody tr:hover, tbody tr:focus-visible { background: var(--panel-hi); }
  .san { font-weight: 700; color: var(--text-hi); }

  @media (max-width: 800px) {
    .explorer { grid-template-columns: 1fr; }
  }
</style>
