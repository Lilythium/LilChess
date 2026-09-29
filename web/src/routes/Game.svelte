<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { auth } from "../lib/auth.svelte";
  import { resultText } from "../lib/format";
  import { createGameStore } from "../lib/game/gameStore.svelte";
  import { connectGameSocket } from "../lib/ws/gameSocket";
  import Board from "../lib/components/Board.svelte";
  import Clock from "../lib/components/Clock.svelte";
  import MoveList from "../lib/components/MoveList.svelte";
  import GameActions from "../lib/components/GameActions.svelte";

  let { id }: { id: string } = $props();

  // App.svelte wraps this component in {#key id}, so capturing the initial id is intended.
  // svelte-ignore state_referenced_locally
  const store = createGameStore(id);
  const view = store.view;

  let resetKey = $state(0);
  let socketStatus = $state<"connecting" | "open" | "closed">("connecting");

  onMount(() => {
    const sock = connectGameSocket(id, {
      onEvent: store.applyEvent,
      onResyncNeeded: () => void store.resync(),
      onStatusChange: (s) => (socketStatus = s),
    });
    return () => sock.close();
  });

  const myColor = $derived.by(() => {
    const p = view.players;
    const u = auth.user;
    if (!p || !u) return null;
    return p.whiteId === u.id ? "white" : p.blackId === u.id ? "black" : null;
  });

  async function sendMove(uci: string) {
    if (!view.game) return;
    try {
      await api(`/api/games/${id}/move`, { body: { ply: view.game.ply, uci } });
      if (socketStatus !== "open") await store.resync(); // no WS event is coming
    } catch {
      await store.resync();
      resetKey++; // snap the board back to the server's position
    }
  }
</script>

{#if view.status === "loading"}
  <p class="muted">Loading…</p>
{:else if view.status === "error"}
  <p class="error">{view.error}</p>
{:else if view.game && view.players}
  {@const g = view.game}
  {@const p = view.players}
  {@const flip = myColor === "black"}
  {@const topSide = flip ? "white" : "black"}
  {@const bottomSide = flip ? "black" : "white"}
  {@const topName = topSide === "white" ? p.whiteName : p.blackName}
  {@const bottomName = bottomSide === "white" ? p.whiteName : p.blackName}

  <div class="game">
    <div class="board-col">
      <div class="bar">
        <a href={"#/u/" + encodeURIComponent(topName)}>{topName}</a>
        <Clock game={g} side={topSide} offset={view.serverOffset} />
      </div>

      <Board game={g} {myColor} {resetKey} onMove={sendMove} onCancel={() => resetKey++} />

      <div class="bar">
        <a href={"#/u/" + encodeURIComponent(bottomName)}>{bottomName}</a>
        <Clock game={g} side={bottomSide} offset={view.serverOffset} />
      </div>
    </div>

    <div class="side panel">
      <MoveList sanByPly={view.sanByPly} ply={g.ply} />
      <GameActions game={g} {myColor} {id} onDone={store.resync} />
      {#if g.status !== "started"}
        <p class="result">{resultText(g)}</p>
        <a href="#/">Back to lobby</a>
      {/if}
      {#if socketStatus === "closed"}<p class="muted">Reconnecting…</p>{/if}
    </div>
  </div>
{/if}

<style>
  .game { display: grid; grid-template-columns: minmax(0, 640px) 300px; gap: 1rem; justify-content: center; }
  .board-col { width: min(100%, calc(100dvh - 180px)); }
  .bar { display: flex; justify-content: space-between; align-items: center; padding: 0.4rem 0; }
  .bar a { color: var(--text-hi); }
  .result { color: var(--text-hi); font-weight: 500; }
  @media (max-width: 800px) {
    .game { grid-template-columns: 1fr; }
    .board-col { width: 100%; }
  }
</style>