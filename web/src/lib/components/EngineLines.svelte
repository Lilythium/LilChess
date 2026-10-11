<script lang="ts">
  import { formatPv, formatScore } from "@lilchess/shared";
  import type { EngineLine } from "../analysis/engine";

  let { lines, fen, depth, searching, onPlay }: {
    lines: EngineLine[];
    fen: string;
    depth: number;
    searching: boolean;
    onPlay: (uci: string) => void;
  } = $props();
</script>

<div class="lines" aria-live="off">
  <div class="head">
    <span>Engine</span>
    <span class="depth">{#if depth}depth {depth}{searching ? "…" : ""}{/if}</span>
  </div>

  {#each lines as line (line.multipv)}
    <button type="button" class="line" onclick={() => line.pv[0] && onPlay(line.pv[0])} title="Play this move">
      <span class="score" class:neg={line.score.kind === "cp" ? line.score.cp < 0 : line.score.kind === "mate" && line.score.moves < 0}>
        {formatScore(line.score)}
      </span>
      <span class="pv">{formatPv(fen, line.pv, 8)}</span>
    </button>
  {:else}
    <p class="empty">{searching ? "Thinking…" : "No evaluation"}</p>
  {/each}
</div>

<style>
  .lines { display: flex; flex-direction: column; background: var(--panel); border-radius: var(--radius); overflow: hidden; }
  .head {
    display: flex; justify-content: space-between; padding: 0.35rem 0.6rem;
    font-size: 0.75rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em;
    border-bottom: 1px solid var(--border);
  }
  .line {
    display: flex; gap: 0.6rem; align-items: baseline; width: 100%; text-align: left;
    padding: 0.4rem 0.6rem; background: transparent; border: 0; border-radius: 0;
    border-bottom: 1px solid var(--border); font-weight: 400;
  }
  .line:last-child { border-bottom: 0; }
  .score {
    flex: none; min-width: 3.2rem; padding: 0.05rem 0.35rem; border-radius: 3px; text-align: center;
    font-weight: 700; font-size: 0.8rem; background: #f0f0f0; color: #262421;
  }
  .score.neg { background: #403d39; color: #e8e8e8; }
  .pv { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); font-size: 0.85rem; }
  .empty { margin: 0; padding: 0.6rem; color: var(--muted); font-size: 0.85rem; }
</style>
