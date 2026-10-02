<script lang="ts">
  import type { Color, GameState } from "@lilchess/shared";
  import { remainingMs, formatClock } from "../game/clock";
  import { formatDuration } from "../format";

  let { game, side, offset }: { game: GameState; side: Color; offset: number } = $props();

  let now = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 100);
    return () => clearInterval(t);
  });

  const running = $derived(
    game.status === "started" && game.turn === side && (game.clock.mode === "correspondence" || game.ply >= 2),
  );
  const live = $derived(game.clock.mode === "live");
  const ms = $derived(remainingMs(game, side, now + offset));
</script>

{#if live}
  <div class="clock" class:running class:low={running && ms < 10_000}>{formatClock(ms)}</div>
{:else if running}
  <div class="clock running">{formatDuration(game.deadlineAt - (now + offset))}</div>
{/if}

<style>
  .clock { font-variant-numeric: tabular-nums; font-size: 1.4rem; padding: .15rem .6rem;
           background: var(--panel-hi); border-radius: var(--radius); color: var(--muted); }
  .running { background: #3a5a1c; color: var(--text-hi); }
  .low { background: var(--red); }
</style>