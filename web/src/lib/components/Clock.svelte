<script lang="ts">
  import type { Color, GameState } from "@lilchess/shared";
  import { remainingMs, formatClock } from "../game/clock";
  import { formatDuration } from "../format";

  let {
    game,
    side,
    offset,
  }: {
    game: GameState;
    side: Color;
    offset: number;
  } = $props();

  let now = $state(Date.now());

  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 100);
    return () => clearInterval(t);
  });

  const running = $derived(
    game.status === "started" &&
      game.turn === side &&
      (game.clock.mode === "correspondence" || game.ply >= 2),
  );

  const live = $derived(game.clock.mode === "live");
  const ms = $derived(remainingMs(game, side, now + offset));
</script>

<div class="clock" class:running class:low={running && ms < 10_000}>
  {#if live}
    {formatClock(ms)}
  {:else if running}
    {formatDuration(game.deadlineAt - (now + offset))}
  {:else}
    {formatClock(ms)}
  {/if}
</div>

<style>
  .clock {
    font-variant-numeric: tabular-nums;
    font-size: 1.4rem;
    font-weight: 600;
    color: var(--text-hi);
    padding: 0.25rem 0;
  }

  .running {
    font-weight: 700;
  }

  .low {
    font-weight: 700;
  }
</style>