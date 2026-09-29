<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { auth } from "../lib/auth.svelte";
  import { formatDuration, timeControl } from "../lib/format";
  import type { GameRow, MyGames } from "../lib/types";

  let data = $state<MyGames | null>(null);
  let error = $state<string | null>(null);
  let now = $state(Date.now());

  async function load() {
    try {
      data = await api<MyGames>("/api/games/my-games");
      now = Date.now();
      error = null;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  onMount(() => {
    void load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  });

  const opponent = (g: GameRow) => (g.white_id === auth.user?.id ? g.black_name : g.white_name);

  function outcome(g: GameRow): string {
    if (g.status === "aborted") return "Aborted";
    if (g.result === "1/2-1/2") return "Draw";
    const iAmWhite = g.white_id === auth.user?.id;
    const whiteWon = g.result === "1-0";
    return whiteWon === iAmWhite ? "Won" : "Lost";
  }
</script>

{#snippet section(title: string, games: GameRow[], kind: "active" | "finished")}
  <div class="panel">
    <h2>{title}</h2>
    {#if games.length === 0}
      <p class="muted">No games.</p>
    {:else}
      <table>
        <tbody>
          {#each games as g (g.id)}
            <tr>
              <td><a href={"#/game/" + g.id}>{opponent(g)}</a></td>
              <td>{timeControl(g)}</td>
              <td class="muted">
                {#if kind === "finished"}
                  {outcome(g)}
                {:else if g.mode === "correspondence"}
                  {formatDuration(g.deadline_at - now)} left
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
{/snippet}

{#if error}
  <p class="error">{error}</p>
{:else if !data}
  <p class="muted">Loading…</p>
{:else}
  <div class="stack">
    {@render section("Your turn", data.myTurn, "active")}
    {@render section("Their turn", data.theirTurn, "active")}
    {@render section("Finished", data.finished, "finished")}
  </div>
{/if}

<style>
  .stack { display: flex; flex-direction: column; gap: 1rem; }
</style>