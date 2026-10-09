<script lang="ts">
  import { api } from "../lib/api";
  import { auth } from "../lib/auth.svelte";
  import { displayName } from "../lib/format";
  import { VARIANTS, VARIANT_LABELS, type Variant } from "@lilchess/shared";

  type Period = "week" | "month" | "year" | "all";
  type Top = { rank: number; username: string; rating: number; rd: number; provisional: boolean; games: number };
  type Mover = { rank: number; username: string; gain: number; from: number; to: number; games: number };
  type Active = { rank: number; username: string; games: number };
  type Board = {
    variant: Variant; period: Period; minGames: number; inactiveDays: number; minPeriodGames: number;
    ranked: number; top: Top[]; improved: Mover[]; active: Active[];
  };

  const PERIOD_LABELS: Record<Period, string> = {
    week: "Past week", month: "Past month", year: "Past year", all: "All time",
  };

  let { variant: variantParam = "standard" }: { variant?: string } = $props();
  const variant = $derived<Variant>(
    (VARIANTS as readonly string[]).includes(variantParam) ? (variantParam as Variant) : "standard",
  );

  let period = $state<Period>("week");
  let data = $state<Board | null>(null);
  let error = $state<string | null>(null);
  let seq = 0; // drops responses that arrive after the user already switched tab/period

  async function load(v: Variant, p: Period) {
    const mine = ++seq;
    try {
      const res = await api<Board>(`/api/leaderboard/${v}?period=${p}`);
      if (mine !== seq) return;
      data = res;
      error = null;
    } catch (err) {
      if (mine === seq) error = err instanceof Error ? err.message : String(err);
    }
  }

  $effect(() => {
    const v = variant;
    const p = period;
    void load(v, p);
    const refresh = () => { if (!document.hidden) void load(v, p); };
    const timer = setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  });

  // Never show the previous tab's data under the new tab's heading.
  const board = $derived(data && data.variant === variant ? data : null);
  const me = $derived(auth.user?.username?.toLowerCase() ?? "");
  const profile = (name: string) => "#/u/" + encodeURIComponent(name);
</script>

<h1>Leaderboard</h1>

<nav class="tabs" aria-label="Variant">
  {#each VARIANTS as v}
    <a
      href={v === "standard" ? "#/leaderboard" : `#/leaderboard/${v}`}
      class="tab"
      class:active={v === variant}
      aria-current={v === variant ? "page" : undefined}
    >{VARIANT_LABELS[v]}</a>
  {/each}
</nav>

{#if error && !board}
  <p class="error">{error}</p>
{:else if !board}
  <p class="muted">Loading…</p>
{:else}
  <section class="panel">
    <h2>{board.top.length >= 10 ? "Top 10" : "Top Players"}</h2>
    {#if board.top.length === 0}
      <p class="muted">
        No ranked players yet. Players appear after {board.minGames} rated {VARIANT_LABELS[variant]} games
        {#if board.inactiveDays > 0}and drop off after {board.inactiveDays} days without a game{/if}.
      </p>
    {:else}
      <div class="table-scroll">
        <table>
          <thead>
            <tr><th class="num">#</th><th>Player</th><th class="num">Rating</th><th class="num hide-sm">RD</th><th class="num">Games</th></tr>
          </thead>
          <tbody>
            {#each board.top as p (p.username)}
              <tr class:me={p.username === me}>
                <td class="num">{p.rank}</td>
                <td><a href={profile(p.username)}>{displayName(p.username)}</a></td>
                <td class="num strong">{p.rating}{#if p.provisional}<span class="prov" title="Provisional rating">?</span>{/if}</td>
                <td class="num hide-sm muted">±{p.rd}</td>
                <td class="num">{p.games}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>

  <div class="period-bar">
    <h2>Activity</h2>
    <select bind:value={period} aria-label="Time period">
      {#each Object.entries(PERIOD_LABELS) as [value, label]}
        <option {value}>{label}</option>
      {/each}
    </select>
  </div>

  <div class="two-col">
    <section class="panel">
      <h2>Most improved</h2>
      {#if board.improved.length === 0}
        <p class="muted">Nobody has gained rating with at least {board.minPeriodGames} rated games in this period.</p>
      {:else}
        <div class="table-scroll">
          <table>
            <thead><tr><th class="num">#</th><th>Player</th><th class="num">Gain</th><th class="num hide-sm">Rating</th><th class="num hide-sm">Games</th></tr></thead>
            <tbody>
              {#each board.improved as m (m.username)}
                <tr class:me={m.username === me}>
                  <td class="num">{m.rank}</td>
                  <td><a href={profile(m.username)}>{displayName(m.username)}</a></td>
                  <td class="num gain">+{m.gain}</td>
                  <td class="num hide-sm muted">{m.from} → {m.to}</td>
                  <td class="num hide-sm">{m.games}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </section>

    <section class="panel">
      <h2>Most active</h2>
      {#if board.active.length === 0}
        <p class="muted">No rated games in this period.</p>
      {:else}
        <div class="table-scroll">
          <table>
            <thead><tr><th class="num">#</th><th>Player</th><th class="num">Games</th></tr></thead>
            <tbody>
              {#each board.active as a (a.username)}
                <tr class:me={a.username === me}>
                  <td class="num">{a.rank}</td>
                  <td><a href={profile(a.username)}>{displayName(a.username)}</a></td>
                  <td class="num strong">{a.games}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </section>
  </div>
{/if}

<style>
  .tabs { display: flex; gap: .25rem; border-bottom: 1px solid var(--border); margin-bottom: 1.25rem; overflow-x: auto; overflow-y: hidden; }
  .tab {
    padding: .6rem 1.1rem; color: var(--muted); text-decoration: none; font-weight: 600;
    border-bottom: 2px solid transparent; white-space: nowrap;
  }
  .tab:hover { color: var(--text-hi); }
  .tab.active { color: var(--text-hi); border-bottom-color: var(--green); }

  .panel { margin-bottom: 1.25rem; }
  .panel h2 { font-size: 1.05rem; margin-bottom: .75rem; }
  .period-bar { display: flex; align-items: center; justify-content: space-between; margin: 1.5rem 0 .75rem; }
  .period-bar h2 { margin: 0; }
  .two-col { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1.25rem; }
  .two-col .panel { margin-bottom: 0; }

  .table-scroll { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: .5rem .6rem; text-align: left; }
  th { color: var(--muted); font-weight: 500; font-size: .8rem; text-transform: uppercase; letter-spacing: .04em; }
  tbody tr { border-top: 1px solid var(--border); }
  tbody tr.me { background: rgba(64, 140, 78, .12); }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .strong { color: var(--text-hi); font-weight: 600; }
  .gain { color: var(--green-hi); font-weight: 600; }
  .prov { color: var(--muted); margin-left: .25rem; cursor: help; }
  a { color: var(--text-hi); text-decoration: none; }
  a:hover { color: var(--blue); }
  .muted { color: var(--muted); }
  .error { color: var(--red); }

  @media (max-width: 600px) { .hide-sm { display: none; } }
</style>