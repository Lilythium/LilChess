<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { displayName, timeControl } from "../lib/format";

  let { id }: { id: string } = $props();

  type GameRow = {
    round: number; id: string; status: string; result: string | null; termination: string | null;
    whiteId: number; whiteName: string; blackId: number; blackName: string;
    forfeit: boolean;
  };

  type SkippedRow = {
    round: number;
    result: string | null;
    voided: boolean;
    whiteName: string;
    blackName: string;
  };

  type Detail = {
    tournament: {
      id: string; name: string; description: string | null; rated: boolean; status: string; mode: "live" | "correspondence";
      initialMs: number | null; incrementMs: number | null; daysPerMove: number | null;
      variant: string; maxPlayers: number; organizer: string; joined: boolean; isOrganizer: boolean;
      startsAt: number | null; endsAt: number | null;
      paused: boolean;
    };
    participants: { id: number; username: string; paused?: boolean }[];
    standings: { id: number; username: string; points: number; wins: number; gamesPlayed: number }[];
    games: GameRow[];
    skipped: SkippedRow[];
  };

  let data = $state<Detail | null>(null);
  let error = $state<string | null>(null);
  let busy = $state(false);

  async function refresh() {
    try {
      const detail = await api<Detail>(`/api/tournaments/${id}`);
      data = detail;
      error = null;
    }
    catch (err) { error = err instanceof Error ? err.message : String(err); }
  }

  onMount(() => {
    void refresh();
    const timer = setInterval(refresh, 5_000);
    return () => clearInterval(timer);
  });

  async function act(action: "join" | "start" | "cancel" | "withdraw" | "resume") {
    if (!data || busy) return;
    busy = true;
    error = null;
    try {
      if (action === "resume") {
        await api(`/api/tournaments/${id}/resume`, { method: "POST" });
      } else {
        await api(`/api/tournaments/${id}/${action === "withdraw" ? "join" : action}`, {
          method: action === "withdraw" ? "DELETE" : "POST",
        });
      }
      await refresh();
    } catch (err) { error = err instanceof Error ? err.message : String(err); }
    finally { busy = false; }
  }

  const control = (t: Detail["tournament"]) => t.mode === "live"
    ? timeControl({ mode: "live", initial_ms: t.initialMs, increment_ms: t.incrementMs, days_per_move: null })
    : `${t.daysPerMove} days per move`;
</script>

<svelte:head><title>{data?.tournament.name ?? "Tournament"} | LilChess</title></svelte:head>

{#if error && !data}
  <p class="error" role="alert">{error}</p>
{:else if !data}
  <p class="muted">Loading tournament…</p>
{:else}
  {@const tournament = data.tournament}
  <article class="tournament-detail">
    <a class="back" href="#/tournaments">← Tournaments</a>
    <header class="event-header">
      <div>
        <p class="eyebrow">ROUND ROBIN · {tournament.status.toUpperCase()}</p>
        <h1>{tournament.name}</h1>
        <p class="meta">Hosted by {displayName(tournament.organizer)} · {control(tournament)} · {tournament.variant === "chess960" ? "Chess960" : "Standard"}{tournament.rated ? " · Rated" : " · Casual"}</p>
        {#if tournament.startsAt}<p class="schedule">Starts {new Date(tournament.startsAt).toLocaleString()}{#if tournament.endsAt} · Ends {new Date(tournament.endsAt).toLocaleString()}{/if}</p>{/if}
      </div>
      <div class="actions">
        {#if tournament.status === "running" && tournament.paused}
          <button class="primary" disabled={busy} onclick={() => act("resume")}>Resume playing</button>
        {/if}
        {#if tournament.status === "open" && !tournament.joined}
          <button class="primary" disabled={busy} onclick={() => act("join")}>Join</button>
        {:else if tournament.status === "open" && tournament.joined && !tournament.isOrganizer}
          <button disabled={busy} onclick={() => act("withdraw")}>Withdraw</button>
        {/if}
        {#if tournament.status === "open" && tournament.isOrganizer}
          <button class="primary" disabled={busy || data.participants.length < 2 || (tournament.startsAt !== null && tournament.startsAt > Date.now())} onclick={() => act("start")}>Start tournament</button>
          <button class="danger" disabled={busy} onclick={() => act("cancel")}>Cancel</button>
        {/if}
      </div>
    </header>
    {#if tournament.description}<p class="description">{tournament.description}</p>{/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if tournament.status === "running" && tournament.paused}
      <p class="notice" role="status">You are paused: a game of yours was aborted, so you forfeited it and will not be paired in the next rounds until you resume.</p>
    {/if}

    <section class="participants">
      <div class="section-title"><h2>Players</h2><span>{data.participants.length} / {tournament.maxPlayers}</span></div>
      <div class="player-list">
        {#each data.participants as player, index (player.id)}
          <a href={`#/u/${encodeURIComponent(player.username)}`}>
            <span class="seed">{String(index + 1).padStart(2, "0")}</span>
            {displayName(player.username)}
            {#if player.username === tournament.organizer}<small>Organizer</small>{/if}
            {#if player.paused}<small>Paused</small>{/if}
          </a>
        {/each}
      </div>
    </section>

    <div class="columns">
      <section>
        <div class="section-title"><h2>Standings</h2></div>
        {#if data.standings.length}
          <div class="table-scroll"><table>
            <thead><tr><th>#</th><th>Player</th><th>Played</th><th>W</th><th>Pts</th></tr></thead>
            <tbody>{#each data.standings as player, index (player.id)}
              <tr><td>{index + 1}</td><td><a href={`#/u/${encodeURIComponent(player.username)}`}>{displayName(player.username)}</a></td><td>{player.gamesPlayed}</td><td>{player.wins}</td><td class="points">{player.points}</td></tr>
            {/each}</tbody>
          </table></div>
        {:else}<p class="muted">No players registered.</p>{/if}
      </section>

      <section>
        <div class="section-title"><h2>Games</h2><span>{data.games.length + (data.skipped?.length ?? 0)}</span></div>
        {#if data.games.length || (data.skipped && data.skipped.length)}
          <div class="games">
            {#each data.games as game (game.id)}
              <a class="game-row" href={`#/game/${game.id}`}>
                <span class="round">R{game.round}</span>
                <span class="players">{displayName(game.whiteName)} <small>vs</small> {displayName(game.blackName)}</span>
                <strong class:active={game.status === "started"}>
                  {game.status === "started" ? "Play" : `${game.result ?? game.status}${game.forfeit ? " (forfeit)" : ""}`}
                </strong>
              </a>
            {/each}

            {#if data.skipped}
              {#each data.skipped as skipped}
                <div class="game-row skipped">
                  <span class="round">R{skipped.round}</span>
                  <span class="players">{displayName(skipped.whiteName)} <small>vs</small> {displayName(skipped.blackName)}</span>
                  <strong>{skipped.voided ? "void" : `${skipped.result} (forfeit)`}</strong>
                </div>
              {/each}
            {/if}
          </div>
        {:else}<p class="muted">Games appear here when the organizer starts the tournament.</p>{/if}
      </section>
    </div>
  </article>
{/if}

<style>
  .tournament-detail { max-width:1000px; margin:0 auto; }
  .back { display:inline-block; color:var(--muted); margin-bottom:1.1rem; font-size:.88rem; }
  .event-header { display:flex; justify-content:space-between; align-items:center; gap:1rem; padding:0 0 1.4rem; border-bottom:1px solid var(--border); }
  .eyebrow { color:#8eaa76; font-size:.72rem; font-weight:700; margin:0 0 .3rem; }
  h1 { margin:0; font-size:1.8rem; overflow-wrap:anywhere; }
  h2 { margin:0; font-size:1.05rem; }
  .meta { margin:.35rem 0 0; color:var(--muted); font-size:.9rem; }
  .schedule { margin:.2rem 0 0; color:#9dbf76; font-size:.84rem; }
  .description { max-width:70ch; padding:.8rem 0; color:var(--text); border-bottom:1px solid var(--border); }
  .actions { display:flex; flex-wrap:wrap; justify-content:end; gap:.5rem; }
  button.danger { color:#e38c84; }
  .participants { padding:1.2rem 0; border-bottom:1px solid var(--border); }
  .section-title { display:flex; justify-content:space-between; align-items:baseline; margin-bottom:.65rem; }
  .section-title span { color:var(--muted); font-size:.85rem; }
  .player-list { display:flex; flex-wrap:wrap; gap:.4rem; }
  .player-list a { display:flex; align-items:center; gap:.45rem; color:var(--text-hi); background:var(--panel); border:1px solid var(--border); border-radius:4px; padding:.35rem .5rem; font-size:.88rem; }
  .player-list small { color:var(--muted); font-size:.72rem; }
  .seed { color:#8eaa76; font-variant-numeric:tabular-nums; }
  .columns { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1.25fr); gap:2rem; padding-top:1.3rem; }
  .table-scroll { overflow-x:auto; }
  th { color:var(--muted); font-size:.78rem; font-weight:500; }
  td { color:var(--text); }
  td:first-child { color:var(--muted); width:2rem; }
  .points { color:var(--text-hi); font-weight:700; }
  .games { border-top:1px solid var(--border); }
  .game-row { display:grid; grid-template-columns:2.3rem minmax(0,1fr) auto; gap:.5rem; align-items:center; padding:.65rem .2rem; border-bottom:1px solid var(--border); color:var(--text-hi); font-size:.88rem; text-decoration: none; }
  .game-row:hover { background:rgba(255,255,255,.035); }
  .round { color:var(--muted); font-size:.78rem; }
  .players { overflow-wrap:anywhere; }
  .players small { color:var(--muted); }
  .game-row strong { text-align:right; font-size:.8rem; font-weight:500; color:var(--muted); text-transform:capitalize; }
  .game-row strong.active { color:#a4ca80; }
  .notice { background:var(--panel); border:1px solid var(--border); border-radius:4px; padding:.6rem .8rem; margin:0 0 1rem; font-size:.9rem; }
  .skipped { opacity:.7; }
  @media(max-width:720px) { .event-header { align-items:flex-start; flex-direction:column; } .actions { justify-content:start; } .columns { grid-template-columns:1fr; gap:1.5rem; } }
</style>