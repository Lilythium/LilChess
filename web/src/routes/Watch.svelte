<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { timeControl } from "../lib/format";
  import GameCard from "../lib/components/GameCard.svelte";
  import type { LiveGameRow } from "../lib/types";

  let games = $state<LiveGameRow[] | null>(null);
  let error = $state<string | null>(null);

  async function load() {
    try {
      games = (await api<{ games: LiveGameRow[] }>("/api/games/live")).games;
      error = null;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  onMount(() => {
    void load();
    const t = setInterval(load, 5_000);
    return () => clearInterval(t);
  });
</script>

{#if error}
  <p class="error">{error}</p>
{:else if !games}
  <p class="muted">Loading…</p>
{:else}
  <div class="panel">
    <h2>Watch live</h2>
    {#if games.length === 0}
      <p class="muted">No games in progress.</p>
    {:else}
      <div class="cards">
        {#each games as g (g.id)}
          <GameCard
            href={"#/game/" + g.id}
            fen={g.fen}
            lastMove={g.last_move}
            title={`${g.white_name} vs ${g.black_name}`}
            subtitle={timeControl(g)}
          />
        {/each}
      </div>
    {/if}
  </div>
{/if}