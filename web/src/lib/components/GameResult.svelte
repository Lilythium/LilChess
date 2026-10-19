<script lang="ts">
  import type { GameState } from "@lilchess/shared";
  import { resultText } from "../format";
  import PgnButton from "./PgnButton.svelte";

  let { game, id }: { game: GameState; id?: string } = $props();
</script>

{#if game.status !== "started"}
  <div class="result-bar">
    <span class="text">{resultText(game)}</span>
    <span class="links">
      {#if id && game.status === "finished"}
        <a href={`#/analysis/${id}`}>Analyse</a>
        <PgnButton {id} label="PGN" />
      {/if}
      <a href="#/">Back to lobby</a>
    </span>
  </div>
{/if}

<style>
  .result-bar { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;
                min-height: 56px; padding: 0 0.75rem; background: var(--panel-hi); border-top: 1px solid var(--border); }
  .text { color: var(--text-hi); font-weight: 600; }
  a { padding: 0.75rem 0; }
  .links { display: flex; align-items: center; flex-wrap: wrap; gap: 0 1rem; }
</style>