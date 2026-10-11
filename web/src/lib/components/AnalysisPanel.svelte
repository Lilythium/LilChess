<script lang="ts">
  import type { Color } from "@lilchess/shared";
  import type { VerdictCounts } from "@lilchess/shared";
  import { DEPTH_PRESETS, type SessionStatus } from "../analysis/analysisSession.svelte";

  let {
    enabled, autoOff, status, error, hasGame, running, done, total, depth, summary, accuracy,
    onToggle, onDepth, onRun, onCancel,
  }: {
    enabled: boolean;
    autoOff: boolean; // off because the connection looks metered, not because the user chose
    status: SessionStatus;
    error: string | null;
    hasGame: boolean; // a stored game is loaded, so a full run makes sense
    running: boolean;
    done: number;
    total: number;
    depth: number;
    summary: Record<Color, VerdictCounts> | null; // null until a run has finished (or been restored from the cache)
    accuracy: Record<Color, number | null> | null;
    onToggle: (on: boolean) => void;
    onDepth: (depth: number) => void;
    onRun: () => void;
    onCancel: () => void;
  } = $props();

  const pct = $derived(total ? Math.round((done / total) * 100) : 0);
</script>

<section class="panel-box">
  <label class="toggle">
    <input type="checkbox" checked={enabled} onchange={(e) => onToggle(e.currentTarget.checked)} />
    <span>Engine analysis</span>
    <span class="state">
      {#if !enabled}off{:else if status === "loading"}loading…{:else if status === "ready"}Stockfish 18{:else if status === "error"}unavailable{/if}
    </span>
  </label>

  {#if autoOff}
    <p class="hint">Engine is off to save data (it's a ~7 MB download). Switch it on when you're ready.</p>
  {/if}

  {#if error}<p class="error" role="alert">{error}</p>{/if}

  {#if enabled && hasGame}
    <div class="run">
      <select aria-label="Analysis depth" value={depth} disabled={running} onchange={(e) => onDepth(Number(e.currentTarget.value))}>
        {#each DEPTH_PRESETS as p (p.depth)}<option value={p.depth}>{p.label} (depth {p.depth})</option>{/each}
      </select>
      {#if running}
        <button type="button" onclick={onCancel}>Cancel</button>
      {:else}
        <button type="button" class="primary" disabled={status === "error"} onclick={onRun}>
          {summary ? "Re-analyse" : "Analyse game"}
        </button>
      {/if}
    </div>

    {#if running}
      <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={pct}>
        <div class="fill" style:width="{pct}%"></div>
      </div>
      <p class="hint">Position {done} of {total}</p>
    {/if}
  {/if}

  <!-- A saved analysis needs no engine, so the results show even while the engine is off. -->
  {#if summary && !running}
    <table class="summary">
      <thead><tr><th></th><th>White</th><th>Black</th></tr></thead>
      <tbody>
        {#if accuracy}
          <tr class="accuracy">
            <th>Accuracy</th>
            <td>{accuracy.white === null ? "–" : `${accuracy.white.toFixed(0)}%`}</td>
            <td>{accuracy.black === null ? "–" : `${accuracy.black.toFixed(0)}%`}</td>
          </tr>
        {/if}
        <tr><th>Inaccuracies</th><td>{summary.white.inaccuracy}</td><td>{summary.black.inaccuracy}</td></tr>
        <tr><th>Mistakes</th><td>{summary.white.mistake}</td><td>{summary.black.mistake}</td></tr>
        <tr><th>Blunders</th><td>{summary.white.blunder}</td><td>{summary.black.blunder}</td></tr>
      </tbody>
    </table>
  {/if}
</section>

<style>
  .panel-box { display: flex; flex-direction: column; gap: 0.6rem; padding: 0.7rem; background: var(--panel); border-radius: var(--radius); }
  .toggle { display: flex; align-items: center; gap: 0.5rem; cursor: pointer; color: var(--text-hi); font-weight: 600; }
  .toggle .state { margin-left: auto; font-weight: 400; font-size: 0.8rem; color: var(--muted); }
  .run { display: flex; gap: 0.5rem; }
  .run select { flex: 1; min-width: 0; }
  .progress { height: 6px; background: var(--border); border-radius: 3px; overflow: hidden; }
  .fill { height: 100%; background: var(--green); transition: width 0.15s linear; }
  .hint { margin: 0; font-size: 0.8rem; color: var(--muted); }
  .error { margin: 0; font-size: 0.85rem; }
  .summary { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  .summary th, .summary td { padding: 0.15rem 0.3rem; text-align: right; font-weight: 400; }
  .summary th:first-child { text-align: left; color: var(--muted); }
  .summary thead th { color: var(--text-hi); font-weight: 600; }
  .summary .accuracy td { color: var(--text-hi); font-weight: 700; }
</style>
