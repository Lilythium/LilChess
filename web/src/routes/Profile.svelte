<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { timeControl } from "../lib/format";
  import type { GameRow } from "../lib/types";

  type ProfileGame = Pick<
    GameRow,
    | "id" | "mode" | "initial_ms" | "increment_ms" | "days_per_move"
    | "result" | "termination" | "ended_at"
    | "white_id" | "black_id" | "white_name" | "black_name"
  >;
  interface ProfileResponse {
    ok: true;
    profile: { id: number; username: string; created_at: number };
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

  function resultLabel(r: string | null): string {
    return r === "1/2-1/2" ? "½–½" : (r ?? "");
  }
</script>

{#if error}
  <p class="error">{error}</p>
{:else if !data}
  <p class="muted">Loading…</p>
{:else}
  <div class="stack">
    <div class="panel">
      <h1>{data.profile.username}</h1>
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
      <h2>Recent games</h2>
      {#if data.games.length === 0}
        <p class="muted">No finished games yet.</p>
      {:else}
        <table>
          <tbody>
            {#each data.games as g (g.id)}
              <tr>
                <td><a href={"#/game/" + g.id}>{g.white_name} vs {g.black_name}</a></td>
                <td>{timeControl(g)}</td>
                <td class="muted">{resultLabel(g.result)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>
  </div>
{/if}

<style>
  .stack { display: flex; flex-direction: column; gap: 1rem; }
</style>