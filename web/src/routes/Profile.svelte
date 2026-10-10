<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { displayName, timeControl } from "../lib/format";
  import type { GameRow } from "../lib/types";
  import GameCard from "../lib/components/GameCard.svelte";

  type ProfileGame = Pick<
    GameRow,
    | "id" | "mode" | "initial_ms" | "increment_ms" | "days_per_move"
    | "result" | "termination" | "ended_at"
    | "white_id" | "black_id" | "white_name" | "black_name"
    | "fen" | "last_move" | "variant"
  >;

  interface ProfileRating {
    variant: string;
    rating: number;
    rd: number;
    games: number;
    provisional: boolean;
  }

  interface RatingPoint {
    gameId: string;
    createdAt: number;
    rating: number;
  }

  interface ProfileResponse {
    ok: true;
    profile: { id: number; username: string; created_at: number };
    ratings?: ProfileRating[];
    history?: RatingPoint[];
    h2h: { wins: number; draws: number; losses: number } | null;
    games: ProfileGame[];
  }

  let { name }: { name: string } = $props();

  let data = $state<ProfileResponse | null>(null);
  let error = $state<string | null>(null);

  onMount(async () => {
    try {
      data = await api<ProfileResponse>(`/api/users/${encodeURIComponent(name)}`);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  });

  const opponent = (g: ProfileGame) => (g.white_id === data?.profile.id ? g.black_name : g.white_name);
  const orientation = (g: ProfileGame): "white" | "black" => (g.black_id === data?.profile.id ? "black" : "white");

  function outcome(g: ProfileGame): string {
    if (g.result === "1/2-1/2") return "Draw";
    const isWhite = g.white_id === data?.profile.id;
    return (g.result === "1-0") === isWhite ? "Won" : "Lost";
  }

  function subtitle(g: ProfileGame): string {
    const tc = timeControl(g);
    return g.result ? `${tc} · ${outcome(g)}` : tc;
  }
</script>

{#if error}
  <p class="error">{error}</p>
{:else if !data}
  <p class="muted">Loading…</p>
{:else}
  <div class="stack">
    <div class="panel">
      <h1>{displayName(data.profile.username)}</h1>
      <p class="muted">Joined {new Date(data.profile.created_at).toLocaleDateString()}</p>
      {#if data.h2h}
        <p>
          Head to head vs you:
          <strong>{data.h2h.wins}</strong> W ·
          <strong>{data.h2h.draws}</strong> D ·
          <strong>{data.h2h.losses}</strong> L
        </p>
      {/if}
    </div>

    <div class="panel">
      <h2>Ratings</h2>
      {#if !data.ratings || data.ratings.length === 0}
        <p class="muted">No ratings established yet.</p>
      {:else}
        <div class="ratings-grid">
          {#each data.ratings as r}
            <div class="rating-box">
              <span class="variant-label">{r.variant}</span>
              <div class="rating-main">
                <span class="rating-number">{r.rating}</span>
                {#if r.provisional}
                  <span class="provisional-badge" title="Provisional rating">?</span>
                {/if}
              </div>
              <span class="muted small">{r.games} games · RD {r.rd}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <div class="panel">
      <h2>Recent games</h2>
      {#if data.games.length === 0}
        <p class="muted">No finished games yet.</p>
      {:else}
        <div class="cards">
          {#each data.games as g (g.id)}
            <GameCard
              href={"#/game/" + g.id}
              fen={g.fen}
              lastMove={g.last_move}
              orientation={orientation(g)}
              title={displayName(opponent(g))}
              subtitle={subtitle(g)}
            />
          {/each}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .stack { display: flex; flex-direction: column; gap: 1rem; }
  .ratings-grid { display: flex; gap: 1rem; flex-wrap: wrap; margin-top: 0.5rem; }
  .rating-box { background: var(--bg-surface, rgba(255,255,255,0.03)); border: 1px solid var(--border, rgba(255,255,255,0.1)); padding: 0.75rem 1rem; border-radius: 6px; flex: 1 1 140px; display: flex; flex-direction: column; gap: 0.25rem; }
  .variant-label { font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
  .rating-main { display: flex; align-items: baseline; gap: 0.5rem; }
  .rating-number { font-size: 1.5rem; font-weight: bold; }
  .provisional-badge { background: var(--accent, #6366f1); color: white; border-radius: 50%; width: 1.25rem; height: 1.25rem; display: inline-flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: bold; }
  .small { font-size: 0.8rem; }
</style>