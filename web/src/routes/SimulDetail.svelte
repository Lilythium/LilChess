<script lang="ts">
  import { onDestroy } from "svelte";
  import { VARIANT_LABELS } from "@lilchess/shared";
  import { api } from "../lib/api";
  import { displayName } from "../lib/format";
  import { navigate } from "../lib/router.svelte";
  import GameCard from "../lib/components/GameCard.svelte";
  import { simulClock } from "../lib/simul/format";
  import { acquireSimulStore } from "../lib/simul/simulStore.svelte";
  import type { SimulBoard } from "../lib/simul/types";

  let { id }: { id: string } = $props();

  // App.svelte wraps this page in {#key id}.
  // svelte-ignore state_referenced_locally
  const lease = acquireSimulStore(id);
  onDestroy(lease.release);
  const view = lease.store.view;

  let usernames = $state("");
  let busy = $state(false);
  let message = $state<string | null>(null);
  let error = $state<string | null>(null);

  const d = $derived(view.detail);

  async function act(path: string, body: unknown = {}): Promise<any> {
    busy = true;
    error = null;
    try {
      return await api(`/api/simuls/${id}/${path}`, { method: "POST", body });
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
      await lease.store.resync();
    }
  }

  async function invite() {
    const names = usernames.split(/[\s,]+/).filter(Boolean);
    if (names.length === 0) return;
    const res = await act("invite", { usernames: names });
    if (!res) return;
    usernames = "";
    message = res.skipped.length
      ? `Invited ${res.invited.length}. Skipped: ${res.skipped.map((s: any) => `${s.username} (${s.reason})`).join(", ")}`
      : `Invited ${res.invited.length}.`;
  }

  async function start() {
    if (await act("start")) {
      const first = lease.store.view.detail?.boards[0];
      if (first && lease.store.view.detail?.simul.mode === "live") navigate(`/game/${first.gameId}`);
    }
  }

  async function cancel() {
    if (confirm("Cancel this simul?") && (await act("cancel"))) navigate("/simuls");
  }

  // The host sees boards that need them first, most urgent on top; everyone else sees them by seat.
  const boards = $derived.by(() => {
    const list = [...(d?.boards ?? [])];
    if (!d?.viewer.isHost) return list;
    const rank = (b: SimulBoard) => (b.status !== "started" ? 2 : b.turn === b.hostColor ? 0 : 1);
    return list.sort((a, b) => rank(a) - rank(b) || (rank(a) === 0 ? a.deadlineAt - b.deadlineAt : a.seat - b.seat));
  });

  function boardLabel(b: SimulBoard): string {
    if (b.status === "aborted") return "Aborted";
    if (b.status === "finished") {
      if (b.result === "1/2-1/2") return "Draw";
      return (b.result === "1-0") === (b.hostColor === "white") ? "Host won" : "Host lost";
    }
    if (b.drawOfferedBy && b.drawOfferedBy !== b.hostColor) return "Draw offered";
    return b.turn === b.hostColor ? "Host to move" : "Waiting for opponent";
  }
</script>

{#if view.status === "error" && !d}
  <p class="error">{view.error}</p>
{:else if !d}
  <p class="muted">Loading…</p>
{:else}
  <div class="panel">
    <h1>{d.simul.name}</h1>
    <p class="muted">
      Host {displayName(d.simul.hostName)} · {simulClock(d.simul)}
      {#if d.simul.mode === "live" && d.simul.hostExtraMs > 0}(+{d.simul.hostExtraMs / 60_000} min for the host){/if}
      · {VARIANT_LABELS[d.simul.variant]} · {d.simul.status}
    </p>
    {#if d.simul.status === "running" || d.simul.status === "completed"}
      <p class="score">
        Host {d.score.points}–{d.score.played - d.score.points}
        <span class="muted">({d.score.wins}W {d.score.draws}D {d.score.losses}L{#if d.score.ongoing}, {d.score.ongoing} playing{/if}{#if d.score.aborted}, {d.score.aborted} aborted{/if})</span>
      </p>
    {/if}
    {#if d.viewer.gameId}<p><a href={"#/game/" + d.viewer.gameId}>Go to your board →</a></p>{/if}
    {#if error}<p class="error">{error}</p>{/if}
  </div>

  {#if d.simul.status === "open"}
    <div class="panel">
      <h2>Players ({d.players.filter((p) => p.status === "accepted").length}/{d.simul.maxPlayers})</h2>
      {#if d.players.length === 0}<p class="muted">Nobody invited yet.</p>{/if}
      <ul class="players">
        {#each d.players as p (p.userId)}
          <li><a href={"#/u/" + encodeURIComponent(p.username)}>{displayName(p.username)}</a><span class="chip {p.status}">{p.status}</span></li>
        {/each}
      </ul>

      {#if d.viewer.isHost}
        <form class="row" onsubmit={(e) => { e.preventDefault(); void invite(); }}>
          <input placeholder="Usernames, separated by spaces or commas" bind:value={usernames}
                 autocapitalize="none" autocorrect="off" spellcheck="false" />
          <button disabled={busy}>Invite</button>
        </form>
        {#if message}<p class="muted">{message}</p>{/if}
        <div class="row">
          <button class="primary" disabled={busy || !d.players.some((p) => p.status === "accepted")} onclick={start}>Start simul</button>
          <button class="danger" disabled={busy} onclick={cancel}>Cancel</button>
        </div>
      {:else if d.viewer.invite}
        <div class="row">
          <button class="primary" disabled={busy || d.viewer.invite === "accepted"} onclick={() => act("respond", { accept: true })}>
            {d.viewer.invite === "accepted" ? "Accepted" : "Accept"}
          </button>
          <button disabled={busy || d.viewer.invite === "declined"} onclick={() => act("respond", { accept: false })}>Decline</button>
        </div>
      {/if}
    </div>
  {:else if d.simul.status === "cancelled"}
    <p class="muted">This simul was cancelled.</p>
  {:else}
    <div class="panel">
      <h2>Boards</h2>
      <div class="cards">
        {#each boards as b (b.gameId)}
          <div class="board" class:to-move={d.viewer.isHost && b.status === "started" && b.turn === b.hostColor}>
            <GameCard href={"#/game/" + b.gameId} fen={b.fen} lastMove={b.lastMove} orientation={b.hostColor}
                      title={`${b.seat}. ${displayName(b.username)}`} subtitle={boardLabel(b)} />
          </div>
        {/each}
      </div>
    </div>
  {/if}
{/if}

<style>
  .score { font-size: 1.2rem; font-weight: 600; margin: 0.25rem 0; }
  .players { list-style: none; margin: 0 0 0.75rem; padding: 0; }
  .players li { display: flex; justify-content: space-between; align-items: center; padding: 0.4rem 0; border-top: 1px solid var(--border); }
  .chip { font-size: 0.8rem; padding: 0.1rem 0.5rem; border-radius: 1rem; background: var(--panel-hi); color: var(--muted); }
  .chip.accepted { color: var(--text-hi); background: var(--green); }
  .row { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.5rem; }
  .row input { flex: 1 1 14rem; }
  .board { border-radius: var(--radius); }
  .board.to-move { outline: 2px solid var(--green); }
</style>