<script lang="ts">
  import type { GameState } from "@lilchess/shared";
  import { resultText } from "../format";

  let { game }: { game: GameState } = $props();
</script>

{#if game.status !== "started"}
  <div class="result-bar">
    <span class="text">{resultText(game)}</span>
    <a href="#/">Back to lobby</a>
  </div>
{/if}

<style>
  .result-bar { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;
                min-height: 56px; padding: 0 0.75rem; background: var(--panel-hi); border-top: 1px solid var(--border); }
  .text { color: var(--text-hi); font-weight: 600; }
  a { padding: 0.75rem 0; }
</style>