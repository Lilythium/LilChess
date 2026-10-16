<script lang="ts">
  import { onMount } from "svelte";
  import { VARIANT_LABELS, type Variant } from "@lilchess/shared";
  import { api } from "../api";
  import { auth } from "../auth.svelte";
  import { displayName } from "../format";
  import { pendingSimuls, simulBadge, tournamentWhen } from "../lobbyEvents";
  import { simulClock } from "../simul/format";
  import type { SimulLists, SimulSummary } from "../simul/types";

  type Row = {
    id: string; name: string; status: string; format: string; mode: "live" | "correspondence"; variant: Variant;
    rated: number; startsAt: number | null; maxPlayers: number; participantCount: number; joined: number;
    durationMs: number | null;
  };

  const FORMAT_LABELS: Record<string, string> = {
    round_robin: "Round robin", swiss: "Swiss", knockout: "Knockout", arena: "Arena", simul2: "Simul²",
  };

  let tournaments = $state<Row[] | null>(null);
  let simuls = $state<SimulSummary[] | null>(null);

  async function load() {
    // Independent: a failure in one list shouldn't blank the other.
    await Promise.allSettled([
      api<{ tournaments: Row[] }>("/api/tournaments?scope=active&limit=5").then((r) => (tournaments = r.tournaments)),
      api<SimulLists>("/api/simuls").then((r) => (simuls = pendingSimuls(r).slice(0, 5))),
    ]);
  }

  onMount(() => {
    void load();
    const t = setInterval(() => { if (!document.hidden) void load(); }, 10_000);
    const onVisible = () => { if (!document.hidden) void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVisible); };
  });

  const variantSuffix = (v: Variant) => (v === "standard" ? "" : ` · ${VARIANT_LABELS[v]}`);
</script>

<div class="panel">
  <div class="head">
    <h2>Tournaments</h2>
    <a href="#/tournaments">All tournaments</a>
  </div>
  {#if tournaments === null}
    <p class="muted">Loading…</p>
  {:else if tournaments.length === 0}
    <p class="muted">No tournaments running or scheduled.</p>
  {:else}
    <ul>
      {#each tournaments as t (t.id)}
        <li>
          <a href={`#/tournament/${t.id}`}>
            <span class="title">{t.name}</span>
            <span class="sub muted">
              {FORMAT_LABELS[t.format] ?? t.format} · {t.mode === "live" ? "Live" : "Correspondence"}{variantSuffix(t.variant)}{t.rated ? " · Rated" : ""}
            </span>
          </a>
          <span class="meta">
            <span class:live={t.status === "running"}>{tournamentWhen(t)}</span>
            <span class="muted">{t.participantCount}/{t.maxPlayers}</span>
            {#if t.joined}<span class="badge">Joined</span>{/if}
          </span>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<div class="panel">
  <div class="head">
    <h2>Pending simuls</h2>
    <a href="#/simuls">All simuls</a>
  </div>
  {#if simuls === null}
    <p class="muted">Loading…</p>
  {:else if simuls.length === 0}
    <p class="muted">No simuls waiting for players.</p>
  {:else}
    <ul>
      {#each simuls as s (s.id)}
        {@const badge = simulBadge(s, auth.user?.id)}
        <li>
          <a href={`#/simul/${s.id}`}>
            <span class="title">{s.name}</span>
            <span class="sub muted">{displayName(s.hostName)} · {simulClock(s)}{variantSuffix(s.variant)}{s.isPublic ? "" : " · Private"}</span>
          </a>
          <span class="meta">
            <span class="muted">{s.accepted}/{s.maxPlayers}</span>
            {#if badge}<span class="badge">{badge}</span>{/if}
          </span>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .head { display: flex; justify-content: space-between; align-items: baseline; gap: .5rem; }
  .head a { font-size: .85rem; }
  ul { list-style: none; margin: 0; padding: 0; }
  li { display: flex; justify-content: space-between; align-items: center; gap: .75rem; padding: .55rem 0; border-bottom: 1px solid var(--border); min-height: var(--tap); }
  li:last-child { border-bottom: none; }
  li a { display: flex; flex-direction: column; min-width: 0; color: var(--text); }
  li a:hover .title { color: var(--text-hi); }
  .title { color: var(--text-hi); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sub { font-size: .8rem; }
  .meta { display: flex; align-items: center; gap: .5rem; flex: 0 0 auto; font-size: .85rem; text-align: right; }
  .live { color: #e5bd67; }
  .badge { color: var(--green-hi); font-size: .78rem; }
</style>
