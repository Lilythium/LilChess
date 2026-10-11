<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { auth } from "../lib/auth.svelte";
  import { displayName, formatDuration, timeControl } from "../lib/format";
  import GameCard from "../lib/components/GameCard.svelte";
  import type { GameRow, MyGames } from "../lib/types";

  let data = $state<MyGames | null>(null);
  let error = $state<string | null>(null);
  let success = $state<string | null>(null);
  let now = $state(Date.now());
  let hostedBoards = $state(0);

  async function importPgn(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    try {
      const pgn = await file.text();
      const result = await api<{ ok: true; imported: string[] }>('/api/games/import', { body: { pgn } });
      success = result.imported.length === 1 ? 'Imported 1 game.' : `Imported ${result.imported.length} games.`;
      error = null;
      input.value = '';
      await load();
    } catch (err) {
      success = null;
      error = err instanceof Error ? err.message : String(err);
      input.value = '';
    }
  }
  
  async function load() {
    try {
      const all = await api<MyGames>("/api/games/my-games");
      const mineOnly = (rows: GameRow[]) => rows.filter((g) => g.simul_host_id !== auth.user?.id);
      hostedBoards = [...all.myTurn, ...all.theirTurn].length - [...mineOnly(all.myTurn), ...mineOnly(all.theirTurn)].length;
      data = { myTurn: mineOnly(all.myTurn), theirTurn: mineOnly(all.theirTurn), finished: mineOnly(all.finished) };
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
  const orientation = (g: GameRow): "white" | "black" => (g.black_id === auth.user?.id ? "black" : "white");

  function outcome(g: GameRow): string {
    if (g.status === "aborted") return "Aborted";
    if (g.result === "1/2-1/2") return "Draw";
    const iAmWhite = g.white_id === auth.user?.id;
    return (g.result === "1-0") === iAmWhite ? "Won" : "Lost";
  }

  function subtitle(g: GameRow, kind: "active" | "finished"): string {
    const tc = timeControl(g);
    if (kind === "finished") return `${tc} · ${outcome(g)}`;
    if (g.mode === "correspondence") return `${tc} · ${formatDuration(g.deadline_at - now)} left`;
    return tc;
  }
</script>

{#snippet section(title: string, games: GameRow[], kind: "active" | "finished")}
  <div class="panel">
    <h2>{title}</h2>
    {#if games.length === 0}
      <p class="muted">No games.</p>
    {:else}
      <div class="cards">
        {#each games as g (g.id)}
          <GameCard
            href={"#/game/" + g.id}
            fen={g.fen}
            lastMove={g.last_move}
            orientation={orientation(g)}
            title={displayName(opponent(g))}
            subtitle={subtitle(g, kind)}
          />
        {/each}
      </div>
    {/if}
  </div>
{/snippet}

{#if error}
  <p class="error">{error}</p>
{:else if !data}
  <p class="muted">Loading…</p>
{:else}
  <div class="panel import-panel">
    <h2>Import PGN</h2>
    <label class="button label-style">
      <input type="file" accept=".pgn,.txt,text/x-chess-pgn" on:change={importPgn} />
      Choose PGN file
    </label>
    {#if success}<p class="success">{success}</p>{/if}
  </div>
  {#if hostedBoards > 0}  <div class="panel"><a href="#/simuls">Your simul: {hostedBoards} {hostedBoards === 1 ? "board" : "boards"} in progress →</a></div>{/if}
  <div class="stack">
    {@render section("Your turn", data.myTurn, "active")}
    {@render section("Their turn", data.theirTurn, "active")}
    {@render section("Finished", data.finished, "finished")}
  </div>
{/if}

<style>
  .stack { display: flex; flex-direction: column; gap: 1rem; }
  .import-panel { display: flex; flex-direction: column; gap: 0.5rem; }
  .label-style { display: inline-flex; align-items: center; gap: 0.5rem; cursor: pointer; }
  .label-style input { display: none; }
  .success { color: #2e7d32; }
</style>