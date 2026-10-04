<script lang="ts">
  import type { Players } from "../types";
  import type { GameState } from "@lilchess/shared";
  import Clock from "./Clock.svelte";
  import MoveNav from "./MoveNav.svelte";
  import MoveList from "./MoveList.svelte";
  import GameActions from "./GameActions.svelte";

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

  const opponentName = $derived.by(() =>
    opponentColor === "white" ? players.whiteName : players.blackName,
  );

  const playerName = $derived.by(() =>
    playerColor === "white" ? players.whiteName : players.blackName,
  );
</script>

<aside class="sidebar">
  <!-- Other player's clock -->
  <Clock game={game} side={opponentColor} offset={serverOffset} />

  <!-- Move navigation -->
  <MoveNav {viewPly} total={game.ply} onNav={onNav} />

  <!-- Move history -->
  <div class="move-box">
    <div class="player-name">
      {opponentName}
    </div>

    <MoveList
      {sanByPly}
      ply={game.ply}
      selected={viewPly}
      {onSelect}
    />

    <div class="player-name">
      {playerName}
    </div>
  </div>

  <!-- Game actions -->
  <GameActions
    game={game}
    {myColor}
    {id}
    onDone={onDone}
  />

  <!-- Your clock -->
  <Clock game={game} side={playerColor} offset={serverOffset} />
</aside>

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    width: 100%;
    min-width: 0;
  }

  .move-box {
    min-height: 0;
    padding: 0.75rem;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
  }

  .player-name {
    padding: 0.25rem 0;
    color: var(--text-hi);
    font-weight: 600;
  }
</style>