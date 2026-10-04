<script lang="ts">
  import type { Players } from "../types";

  let {
    players,
    clock,
    orientation,
  }: {
    players: Players;
    clock: {
      mode: string;
      initialMs?: number;
      incrementMs?: number;
    };
    orientation: "white" | "black";
  } = $props();

  const title = $derived.by(() => {
    if (
      clock.mode === "live" &&
      clock.initialMs !== undefined &&
      clock.incrementMs !== undefined
    ) {
      return `${Math.floor(clock.initialMs / 60000)}+${Math.floor(clock.incrementMs / 1000)}`;
    }

    return clock.mode;
  });

  const topColor = $derived(orientation === "white" ? "black" : "white");
  const bottomColor = $derived(orientation);

  const name = (color: "white" | "black") =>
    color === "white" ? players.whiteName : players.blackName;
</script>

<div class="name-card">
  <div class="title">{title}</div>

  <div class="players">
    <div class="player">
      <span class="piece">{topColor === "white" ? "⚪" : "⚫"}</span>
      <span>{name(topColor)}</span>
    </div>

    <div class="player">
      <span class="piece">{bottomColor === "white" ? "⚪" : "⚫"}</span>
      <span>{name(bottomColor)}</span>
    </div>
  </div>
</div>

<style>
  .name-card {
    width: 100%;
    padding: 0.75rem 1rem;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text-hi);
  }

  .title {
    margin-bottom: 0.5rem;
    color: var(--muted);
    font-size: 0.85rem;
    font-weight: 600;
  }

  .players {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .player {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-weight: 600;
  }

  .piece {
    width: 1.2rem;
    flex: 0 0 1.2rem;
    text-align: center;
  }
</style>