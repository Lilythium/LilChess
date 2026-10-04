<script lang="ts">
  import type { Players } from "../types";
  import type { GameState } from "@lilchess/shared";
  import Clock from "./Clock.svelte";
  import MoveNav from "./MoveNav.svelte";
  import MoveList from "./MoveList.svelte";
  import GameActions from "./GameActions.svelte";
  import GameAlerts from "./GameAlerts.svelte";

  let {
    game,
    players,
    myColor,
    sanByPly,
    viewPly,
    serverOffset,
    id,
    onNav,
    onSelect,
    onDone,
  }: {
    game: GameState;
    players: Players;
    myColor: "white" | "black" | null;
    sanByPly: Record<number, string>;
    viewPly: number | null;
    serverOffset: number;
    id: string;
    onNav: (action: "prev" | "next" | "first" | "last") => void;
    onSelect: (ply: number) => void;
    onDone: () => Promise<void>;
  } = $props();

  const opponentColor = $derived.by(() => {
    if (myColor === "white") return "black";
    if (myColor === "black") return "white";
    return game.turn === "white" ? "black" : "white";
  });

  const playerColor = $derived.by(() => myColor ?? game.turn);

  const opponentName = $derived(
    opponentColor === "white" ? players.whiteName : players.blackName,
  );
  const playerName = $derived(
    playerColor === "white" ? players.whiteName : players.blackName,
  );
</script>

<div class="wrap">
  <aside class="sidebar">
    <div class="slot clock-slot">
      <Clock {game} side={opponentColor} offset={serverOffset} />
    </div>

    <div class="slot nav-slot">
      <MoveNav {viewPly} total={game.ply} {onNav} />
    </div>

    <div class="moves-box">
      <div class="player-name">{opponentName}</div>
      <MoveList {sanByPly} ply={game.ply} selected={viewPly} {onSelect} />
      <div class="player-name">{playerName}</div>
    </div>

    <GameActions {game} {myColor} {id} {onDone} />

    <div class="slot clock-slot">
      <Clock {game} side={playerColor} offset={serverOffset} />
    </div>
  </aside>

  <GameAlerts {game} {myColor} {id} offset={serverOffset} {onDone} />
</div>

<style>
  .wrap { position: relative; width: 100%; min-width: 0; }

  .sidebar {
    display: flex;
    flex-direction: column;
    width: 100%;
    min-width: 0;
    background: var(--panel);
    border-radius: var(--radius);
    overflow: hidden;
  }

  .slot { background: var(--panel-hi); }
  .clock-slot { padding: 0.35rem 0.75rem; }
  .nav-slot { border-top: 1px solid var(--border); }

  .moves-box { padding: 0.5rem 0.75rem; }

  .player-name {
    padding: 0.25rem 0;
    color: var(--text-hi);
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>