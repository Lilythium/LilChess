<script lang="ts">
  import type { Players } from "../types";
  import { displayName, timeControl } from "../format";

  let {
    players,
    clock,
    myColor
  }: {
    players: Players;
    clock: Parameters<typeof timeControl>[0];
    myColor: "white" | "black" | null;
  } = $props();

  // svelte-ignore state_referenced_locally
  const whiteIsMe = myColor === "white";

  const playerName = (color: "white" | "black") => {
    const name = color === "white" ? players.whiteName : players.blackName;
    return displayName(name);
  };
</script>

<div class="name-card">
  <div class="time-control">
    {timeControl(clock)}
  </div>

  <div class="players">
    <div class:me={whiteIsMe} class="player">
      <span class="piece">⚪</span>
      <span>{playerName("white")}</span>
    </div>

    <div class:me={!whiteIsMe && myColor !== null} class="player">
      <span class="piece">⚫</span>
      <span>{playerName("black")}</span>
    </div>
  </div>
</div>

<style>
  .name-card {
    padding: 0 0 0.75rem;
    color: var(--text-hi);
  }

  .time-control {
    font-size: 0.95rem;
    font-weight: 600;
    margin-bottom: 0.4rem;
  }

  .players {
    display: flex;
    gap: 1.25rem;
    align-items: center;
  }

  .player {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    min-width: 0;
  }

  .player.me {
    font-weight: 600;
  }

  .piece {
    font-size: 0.9rem;
  }
</style>