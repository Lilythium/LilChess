<script lang="ts">
  import { onMount } from "svelte";
  import { HOST_COLORS, MAX_SIMUL_PLAYERS, VARIANTS, VARIANT_LABELS } from "@lilchess/shared";
  import { api } from "../lib/api";
  import { auth } from "../lib/auth.svelte";
  import { displayName } from "../lib/format";
  import { navigate } from "../lib/router.svelte";
  import { simulClock } from "../lib/simul/format";
  import type { SimulLists, SimulSummary } from "../lib/simul/types";

  let lists = $state<SimulLists | null>(null);
  let error = $state<string | null>(null);
  let busy = $state(false);

  let form = $state({
    name: "", mode: "live" as "live" | "correspondence", minutes: 10, increment: 0, extraMinutes: 30,
    days: 2, variant: "standard" as (typeof VARIANTS)[number], hostColor: "white" as (typeof HOST_COLORS)[number],
    maxPlayers: 8,
  });

  async function load() {
    try {
      lists = await api<SimulLists>("/api/simuls");
      error = null;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  onMount(() => {
    void load();
    const t = setInterval(() => { if (!document.hidden) void load(); }, 5_000);
    return () => clearInterval(t);
  });

  async function create() {
    busy = true;
    error = null;
    try {
      const live = form.mode === "live";
      const res = await api<{ simulId: string }>("/api/simuls", {
        body: {
          name: form.name, mode: form.mode, variant: form.variant, maxPlayers: form.maxPlayers,
          ...(live
            ? { initialMs: form.minutes * 60_000, incrementMs: form.increment * 1000, hostExtraMinutes: form.extraMinutes }
            : { daysPerMove: form.days, hostColor: form.hostColor }),
        },
      });
      navigate(`/simul/${res.simulId}`);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  async function respond(s: SimulSummary, accept: boolean) {
    try {
      await api(`/api/simuls/${s.id}/respond`, { body: { accept } });
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    await load();
  }
</script>

{#if error}<p class="error">{error}</p>{/if}

{#if lists}
  {#if lists.invitations.length}
    <div class="panel">
      <h2>Invitations</h2>
      <ul class="rows">
        {#each lists.invitations as s (s.id)}
          <li>
            <div class="info">
              <a href={"#/simul/" + s.id}>{s.name}</a>
              <span class="muted">{displayName(s.hostName)} · {simulClock(s)} · {s.accepted}/{s.maxPlayers} joined</span>
            </div>
            <div class="actions">
              <button class:primary={s.myStatus !== "accepted"} onclick={() => respond(s, true)} disabled={s.myStatus === "accepted"}>
                {s.myStatus === "accepted" ? "Accepted" : "Accept"}
              </button>
              <button onclick={() => respond(s, false)}>Decline</button>
            </div>
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if lists.hosting}
    <div class="panel">
      <h2>Your simul</h2>
      <p><a href={"#/simul/" + lists.hosting.id}>{lists.hosting.name}</a>
        <span class="muted">· {lists.hosting.status === "open" ? "waiting for players" : `${lists.hosting.boardsLeft} boards left, ${lists.hosting.boardsToMove} to move`}</span></p>
    </div>
  {:else if !auth.user?.is_guest}
    <form class="panel" onsubmit={(e) => { e.preventDefault(); void create(); }}>
      <h2>Host a simul</h2>
      <div class="grid">
        <label>Name<input bind:value={form.name} minlength="3" maxlength="60" required placeholder="Friday simul" /></label>
        <label>Mode
          <select bind:value={form.mode}>
            <option value="live">Live</option>
            <option value="correspondence">Correspondence</option>
          </select>
        </label>
        {#if form.mode === "live"}
          <label>Minutes per board<input type="number" min="1" max="60" bind:value={form.minutes} /></label>
          <label>Increment (s)<input type="number" min="0" max="60" bind:value={form.increment} /></label>
          <label>Extra minutes for you<input type="number" min="0" max="240" bind:value={form.extraMinutes} /></label>
        {:else}
          <label>Days per move<input type="number" min="1" max="14" bind:value={form.days} /></label>
          <label>Your colour
            <select bind:value={form.hostColor}>
              {#each HOST_COLORS as c}<option value={c}>{c === "alternate" ? "Alternate" : c === "white" ? "White" : "Black"}</option>{/each}
            </select>
          </label>
        {/if}
        <label>Variant
          <select bind:value={form.variant}>{#each VARIANTS as v}<option value={v}>{VARIANT_LABELS[v]}</option>{/each}</select>
        </label>
        <label>Boards (max {MAX_SIMUL_PLAYERS})<input type="number" min="2" max={MAX_SIMUL_PLAYERS} bind:value={form.maxPlayers} /></label>
      </div>
      {#if form.mode === "live"}
        <p class="muted hint">Live simuls: you play white on every board, and your clock runs on every board where it's your move,
          so extra time is how you keep up. Games are casual and takebacks are off.</p>
      {/if}
      <button class="primary" disabled={busy}>Create simul</button>
    </form>
  {/if}

  <div class="panel">
    <h2>Running now</h2>
    {#if lists.running.length === 0}<p class="muted">No simuls in progress.</p>
    {:else}
      <ul class="rows">
        {#each lists.running as s (s.id)}
          <li>
            <div class="info">
              <a href={"#/simul/" + s.id}>{s.name}</a>
              <span class="muted">{displayName(s.hostName)} · {simulClock(s)} · {s.boardsLeft} of {s.accepted} boards left</span>
            </div>
            {#if s.viewerGameId}<a class="btn" href={"#/game/" + s.viewerGameId}>Your board</a>{/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  {#if lists.recent.length}
    <div class="panel">
      <h2>Recently finished</h2>
      <ul class="rows">
        {#each lists.recent as s (s.id)}
          <li><div class="info"><a href={"#/simul/" + s.id}>{s.name}</a>
            <span class="muted">{displayName(s.hostName)} · {s.accepted} boards</span></div></li>
        {/each}
      </ul>
    </div>
  {/if}
{:else if !error}
  <p class="muted">Loading…</p>
{/if}

<style>
  .rows { list-style: none; margin: 0; padding: 0; }
  .rows li { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem 0.75rem;
             padding: 0.6rem 0; border-top: 1px solid var(--border); }
  .info { display: flex; flex-direction: column; min-width: 0; flex: 1 1 12rem; }
  .actions { display: flex; gap: 0.5rem; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(11rem, 100%), 1fr)); gap: 0.75rem; margin-bottom: 0.75rem; }
  label { display: flex; flex-direction: column; gap: 0.25rem; color: var(--muted); font-size: 0.9rem; }
  .hint { margin: 0 0 0.75rem; font-size: 0.9rem; }
  .btn { padding: 0.4rem 0.8rem; background: var(--panel-hi); border-radius: var(--radius); }
</style>