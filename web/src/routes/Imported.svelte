<script lang="ts">
  import { onMount } from "svelte";
  import { VARIANT_LABELS } from "@lilchess/shared";
  import { api } from "../lib/api";
  import { auth } from "../lib/auth.svelte";
  import GameCard from "../lib/components/GameCard.svelte";
  import type { ImportedGameRow, ImportedList, ImportFailure, ImportSummary } from "../lib/types";

  const PAGE = 60;

  let games = $state<ImportedGameRow[]>([]);
  let total = $state(0);
  let loaded = $state(false);
  let error = $state<string | null>(null);
  let busy = $state(false);

  let summary = $state<{ imported: number; duplicates: number; overLimit: number; failures: ImportFailure[] } | null>(null);

  async function load(offset = 0) {
    try {
      const page = await api<ImportedList>(`/api/imported?limit=${PAGE}&offset=${offset}`);
      games = offset === 0 ? page.games : [...games, ...page.games];
      total = page.total;
      error = null;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loaded = true;
    }
  }

  async function importFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    busy = true;
    try {
      const result = await api<ImportSummary>("/api/imported", { body: { pgn: await file.text() } });
      summary = { imported: result.imported.length, duplicates: result.duplicates, overLimit: result.overLimit, failures: result.failures };
      error = null;
      await load();
    } catch (err) {
      summary = null;
      error = err instanceof Error ? err.message : String(err);
    } finally {
      input.value = "";
      busy = false;
    }
  }

  async function remove(game: ImportedGameRow) {
    if (!confirm(`Delete ${game.white} vs ${game.black}?`)) return;
    try {
      await api(`/api/imported/${game.id}`, { method: "DELETE" });
      games = games.filter((g) => g.id !== game.id);
      total = Math.max(0, total - 1);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  // Players are only names. If one of them happens to be this account, put that side at the bottom of the board.
  const sameName = (a: string, b?: string) => !!b && a.toLowerCase() === b.toLowerCase();
  const orientation = (g: ImportedGameRow): "white" | "black" =>
    sameName(g.black, auth.user?.username) && !sameName(g.white, auth.user?.username) ? "black" : "white";

  const resultText = (r: ImportedGameRow["result"]) =>
    r === "1-0" ? "1–0" : r === "0-1" ? "0–1" : r === "1/2-1/2" ? "½–½" : "Unfinished";

  function subtitle(g: ImportedGameRow): string {
    const parts = [resultText(g.result)];
    if (g.date && !g.date.startsWith("????")) parts.push(g.date.replace(/\.\?\?/g, ""));
    if (g.timeControl) parts.push(g.timeControl);
    if (g.variant !== "standard") parts.push(VARIANT_LABELS[g.variant]);
    return parts.join(" · ");
  }

  onMount(() => void load());
</script>

<div class="stack">
  <div class="panel intro">
    <h1>Imported games</h1>
    <p class="muted">
      Games from PGN files. They're private to you, kept apart from your game history, head-to-head records and ratings,
      and the players are just names from the file.
    </p>
    <label class="button label-style" class:disabled={busy}>
      <input type="file" accept=".pgn,.txt,text/x-chess-pgn" onchange={importFile} disabled={busy} />
      {busy ? "Importing…" : "Choose PGN file"}
    </label>

    {#if summary}
      <div class="result" role="status">
        {#if summary.imported > 0}
          <p class="success">Imported {summary.imported} {summary.imported === 1 ? "game" : "games"}.</p>
        {:else}
          <p class="muted">Nothing new was imported.</p>
        {/if}
        {#if summary.duplicates > 0}
          <p class="muted">{summary.duplicates} already imported, skipped.</p>
        {/if}
        {#if summary.overLimit > 0}
          <p class="error">{summary.overLimit} not imported: you've reached the limit. Delete some games to import more.</p>
        {/if}
        {#if summary.failures.length > 0}
          <p class="error">Couldn't import:</p>
          <ul>
            {#each summary.failures as f}<li><strong>{f.label}:</strong> {f.message}</li>{/each}
          </ul>
        {/if}
      </div>
    {/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <p><a href="#/analysis">Open the analysis board</a> · <a href="#/games">Back to my games</a></p>
  </div>

  <div class="panel">
    <h2>{total > 0 ? `${total} imported ${total === 1 ? "game" : "games"}` : "Your imports"}</h2>
    {#if !loaded}
      <p class="muted">Loading…</p>
    {:else if games.length === 0}
      <p class="muted">No imported games yet.</p>
    {:else}
      <div class="cards">
        {#each games as g (g.id)}
          <div class="item">
            <GameCard
              href={"#/analysis/imported/" + g.id}
              fen={g.fen}
              lastMove={g.lastMove}
              orientation={orientation(g)}
              title={`${g.white} vs ${g.black}`}
              subtitle={subtitle(g)}
            />
            <button class="danger small" onclick={() => remove(g)}>Delete</button>
          </div>
        {/each}
      </div>
      {#if games.length < total}
        <p><button onclick={() => load(games.length)}>Show more</button></p>
      {/if}
    {/if}
  </div>
</div>

<style>
  .stack { display: flex; flex-direction: column; gap: 1rem; }
  .intro { display: flex; flex-direction: column; gap: 0.5rem; align-items: flex-start; }
  .intro h1, .intro p { margin: 0; }
  .item { display: flex; flex-direction: column; gap: 0.25rem; min-width: 0; }
  .small { align-self: flex-start; font-size: 0.8rem; padding: 0.15rem 0.4rem; color: var(--muted); }
  .label-style { display: inline-flex; align-items: center; gap: 0.5rem; cursor: pointer; }
  .label-style input { display: none; }
  .label-style.disabled { opacity: 0.5; cursor: default; }
  .result ul { margin: 0.25rem 0 0; padding-left: 1.2rem; }
  .success { color: #2e7d32; }
</style>