<script lang="ts">
  import { onMount } from "svelte";
  import {
    DEFAULT_RATING_HISTORY_RANGE, RATING_HISTORY_RANGES, RATING_HISTORY_RANGE_KEYS,
    type RatingHistoryRange,
  } from "@lilchess/shared";
  import { api } from "../lib/api";
  import { displayName, timeControl } from "../lib/format";
  import type { ChartPoint } from "../lib/ratingChart";
  import type { GameRow } from "../lib/types";
  import GameCard from "../lib/components/GameCard.svelte";
  import RatingChart from "../lib/components/RatingChart.svelte";

  type ProfileGame = Pick<
    GameRow,
    | "id" | "mode" | "initial_ms" | "increment_ms" | "days_per_move"
    | "result" | "termination" | "ended_at"
    | "white_id" | "black_id" | "white_name" | "black_name"
    | "fen" | "last_move" | "variant"
  >;

  interface ProfileRating {
    variant: string;
    label: string;
    rating: number;
    rd: number;
    games: number;
    provisional: boolean;
    /** Rating change over the last 12 rated games. */
    delta: number;
    /** Percent of ranked players this player out-rates; null until it is meaningful. */
    percentile: number | null;
    pool: number;
  }

  interface ProfileResponse {
    ok: true;
    profile: { id: number; username: string; created_at: number };
    ratings: ProfileRating[];
    h2h: { wins: number; draws: number; losses: number } | null;
    games: ProfileGame[];
  }

  interface HistoryResponse { since: number; points: ChartPoint[] }

  let { name }: { name: string } = $props();

  let data = $state<ProfileResponse | null>(null);
  let error = $state<string | null>(null);

  // Rating graph: classical (standard) first, any variant on click.
  let selected = $state("standard");
  let range = $state<RatingHistoryRange>(DEFAULT_RATING_HISTORY_RANGE);
  let history = $state<HistoryResponse | null>(null);
  let historyLoading = $state(false);
  let historyEnd = $state(Date.now());
  const cache = new Map<string, HistoryResponse>();
  let seq = 0; // drops responses for a variant/range the user has already clicked away from

  onMount(async () => {
    try {
      data = await api<ProfileResponse>(`/api/users/${encodeURIComponent(name)}`);
      if (!data.ratings.some((r) => r.variant === selected)) selected = data.ratings[0]?.variant ?? "standard";
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  });

  async function loadHistory(variant: string, r: RatingHistoryRange) {
    const key = `${variant}:${r}`;
    const mine = ++seq;
    const hit = cache.get(key);
    if (hit) {
      history = hit;
      historyEnd = Date.now();
      return;
    }
    historyLoading = true;
    try {
      const res = await api<HistoryResponse>(
        `/api/users/${encodeURIComponent(name)}/rating-history?variant=${encodeURIComponent(variant)}&range=${r}`,
      );
      if (mine !== seq) return;
      cache.set(key, res);
      history = res;
      historyEnd = Date.now();
    } catch {
      if (mine === seq) history = { since: 0, points: [] };
    } finally {
      if (mine === seq) historyLoading = false;
    }
  }

  $effect(() => {
    if (data) void loadHistory(selected, range);
  });

  const current = $derived(data?.ratings.find((r) => r.variant === selected) ?? null);
  const chartPoints = $derived(history?.points ?? []);
  const chartStart = $derived(history && history.since > 0 ? history.since : (chartPoints[0]?.createdAt ?? historyEnd));

  const ratingText = (r: ProfileRating) => (r.games === 0 ? "Unrated" : `${r.rating}${r.provisional ? "?" : ""}`);
  const deltaText = (d: number) => (d > 0 ? `+${d}` : d < 0 ? `\u2212${Math.abs(d)}` : "0");
  const deltaClass = (d: number) => (d > 0 ? "up" : d < 0 ? "down" : "flat");

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

    <div class="ratings-layout">
      <nav class="variant-list" aria-label="Variants">
        {#each data.ratings as r (r.variant)}
          <button
            class="variant-item"
            class:active={r.variant === selected}
            aria-pressed={r.variant === selected}
            onclick={() => (selected = r.variant)}
          >
            <span class="variant-name">{r.label}</span>
            <span class="variant-rating">{ratingText(r)}</span>
            {#if r.games > 0}
              <span class="variant-delta {deltaClass(r.delta)}" title="Change over the last 12 rated games">{deltaText(r.delta)}</span>
            {/if}
          </button>
        {/each}
      </nav>

      <div class="panel detail">
        {#if current}
          <div class="detail-head">
            <div>
              <h2>{current.label}</h2>
              <div class="big-rating">
                <span class="rating-number">{ratingText(current)}</span>
                {#if current.games > 0}
                  <span class="delta {deltaClass(current.delta)}" title="Change over the last 12 rated games">
                    {deltaText(current.delta)} <span class="muted small">last 12 games</span>
                  </span>
                {/if}
              </div>
              <p class="muted small">
                {current.games} rated game{current.games === 1 ? "" : "s"}{current.games > 0 ? ` · RD ${current.rd}` : ""}
              </p>
              {#if current.percentile !== null}
                <p class="percentile">
                  Better than <strong>{current.percentile}%</strong> of {current.label} players
                  <span class="muted small">({current.pool} compared)</span>
                </p>
              {:else if current.games > 0}
                <p class="muted small">Percentile appears once the rating is established and other players are ranked.</p>
              {/if}
            </div>
            <label class="range">
              <span class="muted small">Period</span>
              <select bind:value={range}>
                {#each RATING_HISTORY_RANGE_KEYS as k (k)}
                  <option value={k}>{RATING_HISTORY_RANGES[k].label}</option>
                {/each}
              </select>
            </label>
          </div>
          <RatingChart points={chartPoints} start={chartStart} end={historyEnd} loading={historyLoading} />
        {/if}
      </div>
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
  .small { font-size: 0.8rem; }

  .ratings-layout { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 1rem; align-items: start; }
  .variant-list { display: flex; flex-direction: column; gap: .4rem; }
  .variant-item {
    display: grid; grid-template-columns: 1fr auto; grid-template-areas: "name delta" "rating delta";
    gap: 0 .5rem; text-align: left; align-items: center; background: var(--panel);
    border: 1px solid var(--border); padding: .6rem .8rem; min-height: var(--tap);
  }
  .variant-item.active { border-color: var(--green); background: var(--panel-hi); }
  .variant-name { grid-area: name; font-size: .8rem; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
  .variant-rating { grid-area: rating; font-size: 1.25rem; font-weight: 700; color: var(--text-hi); }
  .variant-delta { grid-area: delta; font-weight: 600; }

  .detail-head { display: flex; justify-content: space-between; gap: 1rem; flex-wrap: wrap; margin-bottom: .75rem; }
  .detail-head h2 { margin-bottom: .25rem; }
  .detail-head p { margin: .15rem 0; }
  .big-rating { display: flex; align-items: baseline; gap: .75rem; flex-wrap: wrap; }
  .rating-number { font-size: 2rem; font-weight: 700; color: var(--text-hi); }
  .delta { font-weight: 600; }
  .percentile { color: var(--text-hi); }
  .range { display: grid; gap: .2rem; align-self: start; }

  .up { color: var(--green-hi); }
  .down { color: var(--red); }
  .flat { color: var(--muted); }

  @media (max-width: 700px) {
    .ratings-layout { grid-template-columns: 1fr; }
    .variant-list { flex-direction: row; overflow-x: auto; padding-bottom: .25rem; }
    .variant-item { flex: 0 0 auto; min-width: 8.5rem; }
  }
</style>