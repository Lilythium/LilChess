<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { auth } from "../lib/auth.svelte";
  import { createGameStore } from "../lib/game/gameStore.svelte";
  import { connectGameSocket } from "../lib/ws/gameSocket";
  import Board from "../lib/components/Board.svelte";
  import NameCard from "../lib/components/NameCard.svelte";
  import GameSidebar from "../lib/components/GameSidebar.svelte";
  import { selectPly, stepView, type NavAction } from "../lib/game/history";
  import { playSound } from "../lib/audio/audio";

  let { id }: { id: string } = $props();

  // App.svelte wraps this component in {#key id}, so capturing the initial id is intended.
  // svelte-ignore state_referenced_locally
  const store = createGameStore(id);
  const view = store.view;

  let resetKey = $state(0);
  let socketStatus = $state<"connecting" | "open" | "closed">("connecting");

  // null = follow the live position.
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
    if (view.game) {
      viewPly = stepView(viewPly, view.game.ply, action);
    }
  }

  function onKey(e: KeyboardEvent) {
    const t = e.target;

    if (
      t instanceof HTMLElement &&
      ["INPUT", "SELECT", "TEXTAREA"].includes(t.tagName)
    ) {
      return;
    }

    const keys = {
      ArrowLeft: "prev",
      ArrowRight: "next",
      ArrowUp: "first",
      ArrowDown: "last",
    } as const;

    const action = keys[e.key as keyof typeof keys];

    if (!action) return;

    e.preventDefault();
    nav(action);
  }

  onMount(() => {
    playSound("gameStart");

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

    return p.whiteId === u.id
      ? "white"
      : p.blackId === u.id
        ? "black"
        : null;
  });

  async function sendMove(uci: string) {
    if (!view.game) return;

    try {
      await api(`/api/games/${id}/move`, {
        body: {
          ply: view.game.ply,
          uci,
        },
      });

      if (socketStatus !== "open") {
        await store.resync();
      }
    } catch {
      await store.resync();
      resetKey++;
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

  <div class="game">
    <div class="board-area">
      <NameCard
        players={p}
        clock={g.clock as any}
        {myColor}
      />

      <Board
        game={g}
        {myColor}
        {resetKey}
        viewPly={viewPly ?? g.ply}
        onMove={sendMove}
        onCancel={() => resetKey++}
      />
    </div>

    <GameSidebar
      game={g}
      players={p}
      {myColor}
      sanByPly={Object.values(view.sanByPly ?? {})}
      viewPly={viewPly ?? g.ply}
      serverOffset={view.serverOffset}
      {id}
      onNav={nav}
      onDone={store.resync}
    />
  </div>
{/if}