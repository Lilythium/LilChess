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
  import MoveNav from "../lib/components/MoveNav.svelte";
  import GameActions from "../lib/components/GameActions.svelte";
  import { selectPly, stepView, type NavAction } from "../lib/game/history";

  let { id }: { id: string } = $props();

  // App.svelte wraps this component in {#key id}, so capturing the initial id is intended.
  // svelte-ignore state_referenced_locally
  const store = createGameStore(id);
  const view = store.view;

  let resetKey = $state(0);
  let socketStatus = $state<"connecting" | "open" | "closed">("connecting");

  // null = follow the live position. Jump back to it whenever the ply changes
  // (a move was played, or a takeback removed one).
  let viewPly = $state<number | null>(null);
  let lastPly = 0;
  $effect(() => {
    const ply = view.game?.ply ?? 0;
    if (ply !== lastPly) {
      lastPly = ply;
      viewPly = null;
    }
  });

  function nav(action: NavAction) {
    if (view.game) viewPly = stepView(viewPly, view.game.ply, action);
  }

  function onKey(e: KeyboardEvent) {
    const t = e.target;
    if (t instanceof HTMLElement && ["INPUT", "SELECT", "TEXTAREA"].includes(t.tagName)) return;
    const keys = { ArrowLeft: "prev", ArrowRight: "next", ArrowUp: "first", ArrowDown: "last" } as const;
    const action = keys[e.key as keyof typeof keys];
    if (!action) return;
    e.preventDefault();
    nav(action);
  }

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

<svelte:window onkeydown={onKey} />

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

      <Board game={g} {myColor} {resetKey} {viewPly} onMove={sendMove} onCancel={() => resetKey++} />

      <div class="bar">
        <a href={"#/u/" + encodeURIComponent(bottomName)}>{bottomName}</a>
        <Clock game={g} side={bottomSide} offset={view.serverOffset} />
      </div>

      {#if view.h2h && myColor}
        {@const oppName = myColor === "white" ? p.blackName : p.whiteName}
        <div class="h2h">
          Head to head vs {oppName}:
          <strong>{view.h2h.wins}</strong> W ·
          <strong>{view.h2h.draws}</strong> D ·
          <strong>{view.h2h.losses}</strong> L
        </div>
      {/if}
    </div>

    <div class="side panel">
      <MoveList
        sanByPly={view.sanByPly}
        ply={g.ply}
        bind:selected={viewPly}
        onSelect={(p) => (viewPly = selectPly(p, g.ply))}
      />
      <MoveNav {viewPly} total={g.ply} onNav={nav} />
      <GameActions game={g} {myColor} {id} onDone={store.resync} />
      {#if !myColor}<p class="muted">You are spectating</p>{/if}
      {#if g.status !== "started"}
        <p class="result">{resultText(g)}</p>
        <a href="#/">Back to lobby</a>
      {/if}
      <a class="muted" href={"/api/games/" + id + "/pgn"} download>Download PGN</a>
    </div>
  </div>
{/if}