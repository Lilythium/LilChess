<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { auth } from "../lib/auth.svelte";
  import { timeControl } from "../lib/format";

  type TournamentRow = {
    id: string; name: string; status: string; mode: "live" | "correspondence";
    variant: string; maxPlayers: number; participantCount: number; gameCount: number; joined: number;
  };

  let tournaments = $state<TournamentRow[] | null>(null);
  let error = $state<string | null>(null);
  let busy = $state(false);
  let name = $state("");
  let mode = $state<"live" | "correspondence">("live");
  let clockPreset = $state("300000:2000");
  let daysPerMove = $state(3);
  let maxPlayers = $state(8);
  let variant = $state("standard");

  async function refresh() {
    try {
      tournaments = (await api<{ tournaments: TournamentRow[] }>("/api/tournaments")).tournaments;
      error = null;
    } catch (err) { error = err instanceof Error ? err.message : String(err); }
  }

  onMount(() => {
    void refresh();
    const timer = setInterval(refresh, 10_000);
    return () => clearInterval(timer);
  });

  async function create() {
    if (busy) return;
    busy = true;
    error = null;
    try {
      const [initialMs, incrementMs] = clockPreset.split(":").map(Number);
      await api("/api/tournaments", {
        body: {
          name,
          mode,
          ...(mode === "live" ? { initialMs, incrementMs } : { daysPerMove }),
          maxPlayers,
          variant,
        },
      });
      name = "";
      await refresh();
    } catch (err) { error = err instanceof Error ? err.message : String(err); }
    finally { busy = false; }
  }

  const formatClock = (t: TournamentRow) => t.mode === "live" ? "Live" : "Correspondence";
</script>

<svelte:head><title>Tournaments | LilChess</title></svelte:head>

<section class="tournaments">
  <header class="title-row">
    <div>
      <p class="eyebrow">COMPETITION</p>
      <h1>Tournaments</h1>
    </div>
    <span class="count">{tournaments?.length ?? "…"} events</span>
  </header>

  {#if !auth.user?.is_guest}
    <form class="create" onsubmit={(event) => { event.preventDefault(); void create(); }}>
      <div class="create-heading"><h2>Host a tournament</h2><span>Round robin</span></div>
      <label class="name-field">Name<input bind:value={name} minlength="3" maxlength="60" placeholder="Friday club night" required /></label>
      <div class="settings">
        <label>Time mode
          <select bind:value={mode}><option value="live">Live</option><option value="correspondence">Correspondence</option></select>
        </label>
        {#if mode === "live"}
          <label>Clock
            <select bind:value={clockPreset}>
              <option value="60000:0">1 + 0</option><option value="180000:2000">3 + 2</option>
              <option value="300000:0">5 + 0</option><option value="300000:3000">5 + 3</option>
              <option value="600000:0">10 + 0</option>
            </select>
          </label>
        {:else}
          <label>Days per move<select bind:value={daysPerMove}><option value={1}>1 day</option><option value={3}>3 days</option><option value={7}>7 days</option><option value={14}>14 days</option></select></label>
        {/if}
        <label>Players<select bind:value={maxPlayers}>{#each [2, 4, 6, 8, 10, 12, 16] as count}<option value={count}>{count}</option>{/each}</select></label>
        <label>Variant<select bind:value={variant}><option value="standard">Standard</option><option value="chess960">Chess960</option></select></label>
        <button class="primary create-button" type="submit" disabled={busy || name.trim().length < 3}>{busy ? "Creating…" : "Create"}</button>
      </div>
    </form>
  {/if}

  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if tournaments === null}
    <p class="muted">Loading tournaments…</p>
  {:else if tournaments.length === 0}
    <p class="empty">No tournaments yet.</p>
  {:else}
    <div class="event-list">
      {#each tournaments as tournament (tournament.id)}
        <a class="event" href={`#/tournament/${tournament.id}`}>
          <span class="event-name">{tournament.name}<small>{formatClock(tournament)} · {tournament.variant === "chess960" ? "Chess960" : "Standard"}</small></span>
          <span class="event-meta"><strong class:open={tournament.status === "open"} class:running={tournament.status === "running"}>{tournament.status}</strong>{tournament.participantCount}/{tournament.maxPlayers} players · {tournament.gameCount} games</span>
          {#if tournament.joined}<span class="joined">Joined</span>{/if}
        </a>
      {/each}
    </div>
  {/if}
</section>

<style>
  .tournaments { max-width: 900px; margin: 0 auto; }
  .title-row { display:flex; align-items:end; justify-content:space-between; border-bottom:1px solid var(--border); padding:0 0 1rem; margin-bottom:1.25rem; }
  .eyebrow { color:#8eaa76; font-size:.72rem; font-weight:700; margin:0 0 .2rem; }
  h1 { margin:0; font-size:1.7rem; }
  h2 { margin:0; font-size:1.05rem; }
  .count,.create-heading span { color:var(--muted); font-size:.85rem; }
  .create { padding:1rem 0 1.25rem; border-bottom:1px solid var(--border); margin-bottom:1.2rem; }
  .create-heading { display:flex; align-items:baseline; gap:.75rem; margin-bottom:.8rem; }
  label { display:grid; gap:.35rem; color:var(--muted); font-size:.8rem; }
  input,select { width:100%; min-width:0; }
  .name-field { max-width:34rem; margin-bottom:.75rem; }
  .settings { display:grid; grid-template-columns:repeat(4,minmax(110px,1fr)) auto; gap:.7rem; align-items:end; }
  .create-button { min-height:42px; }
  .event-list { border-top:1px solid var(--border); }
  .event { display:grid; grid-template-columns:minmax(0,1fr) auto auto; gap:1.2rem; align-items:center; padding:.9rem .4rem; color:var(--text); border-bottom:1px solid var(--border); }
  .event:hover { background:rgba(255,255,255,.035); color:var(--text-hi); }
  .event-name { font-weight:600; color:var(--text-hi); }
  small { display:block; color:var(--muted); font-weight:400; }
  .event-meta { text-align:right; color:var(--muted); font-size:.84rem; }
  .event-meta strong { display:block; color:var(--muted); text-transform:capitalize; }
  .event-meta strong.open { color:#9dbf76; }
  .event-meta strong.running { color:#e5bd67; }
  .joined { color:#9dbf76; font-size:.8rem; }
  .empty { padding:2rem 0; color:var(--muted); }
  @media(max-width:700px) { .settings { grid-template-columns:repeat(2,minmax(0,1fr)); } .create-button { grid-column:1/-1; } }
  @media(max-width:480px) { .event { grid-template-columns:1fr auto; gap:.35rem .6rem; } .event-meta { text-align:left; } .joined { text-align:right; } }
</style>