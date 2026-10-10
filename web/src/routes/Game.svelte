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
  import type { Color, GameState } from "@lilchess/shared";
  import { viewport } from "../lib/viewport.svelte";
  import { gameTitle } from "../lib/format";
  import PlayerStrip from "../lib/components/PlayerStrip.svelte";
  import MoveStrip from "../lib/components/MoveStrip.svelte";
  import GameActions from "../lib/components/GameActions.svelte";
  import GameAlerts from "../lib/components/GameAlerts.svelte";
  import GameResult from "../lib/components/GameResult.svelte";
  import { keepAwake } from "../lib/wakeLock";
  import SimulBar from "../lib/components/SimulBar.svelte";

  let { id }: { id: string } = $props();

  // App.svelte wraps this component in {#key id}, so capturing the initial id is intended.
  // svelte-ignore state_referenced_locally
  const store = createGameStore(id);
  const view = store.view;

  let resetKey = $state(0);
  let socketStatus = $state<"connecting" | "open" | "closed">("connecting");

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

  const orientation = $derived(
    myColor === "black" ? "black" : "white",
  );

  const topColor = $derived<Color>(orientation === "white" ? "black" : "white");
  const bottomColor = $derived<Color>(orientation);

  const side = (c: Color) => {
    const p = view.players;
    return c === "white"
      ? {
          name: p?.whiteName ?? "",
          rating: p?.whiteRating?.rating ?? null,
          provisional: p?.whiteRating?.provisional ?? false,
        }
      : {
          name: p?.blackName ?? "",
          rating: p?.blackRating?.rating ?? null,
          provisional: p?.blackRating?.provisional ?? false,
        };
  };

  // Keep the screen on during my own live games (needs HTTPS; a no-op elsewhere).
  const keepScreenOn = $derived(
    myColor !== null && view.game?.status === "started" && view.game.clock.mode === "live",
  );
  $effect(() => { if (keepScreenOn) return keepAwake(); });

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

<svelte:head>
  {#if view.game && view.players}
    <title>{gameTitle(view.game.clock, view.game.variant)}</title>
  {/if}
</svelte:head>

{#if view.status === "loading"}
  <p class="muted">Loading…</p>
{:else if view.status === "error"}
  <p class="error">{view.error}</p>
{:else if view.game && view.players}
  {@const g = view.game}
  {@const p = view.players}

  {#if viewport.mobile}
    <div class="game-mobile" style:--simul-h={view.simul ? "56px" : "0px"}>
      {#if view.simul}
        <div class="simul-area">
          <SimulBar
            simulId={view.simul.id}
            gameId={id}
            name={view.simul.name}
            hostName={view.simul.hostName}
            isHost={view.simul.hostId === auth.user?.id}
          />
        </div>
      {/if}

      <PlayerStrip
        color={topColor}
        {...side(topColor)}
        game={g}
        offset={view.serverOffset}
      />

      <div class="board-area">
        <Board
          game={g}
          {myColor}
          {orientation}
          {resetKey}
          viewPly={viewPly ?? g.ply}
          onMove={sendMove}
          onCancel={() => resetKey++}
        />
      </div>

      <PlayerStrip
        color={bottomColor}
        {...side(bottomColor)}
        game={g}
        offset={view.serverOffset}
      />

      <MoveStrip
        sanByPly={view.sanByPly}
        ply={g.ply}
        {viewPly}
        onNav={nav}
        onSelect={(ply: number) => (viewPly = selectPly(ply, g.ply))}
      />

      <GameAlerts
        game={g}
        {myColor}
        {id}
        offset={view.serverOffset}
        onDone={store.resync}
      />

      <GameActions
        game={g}
        {id}
        {myColor}
        onDone={store.resync}
      />

      <GameResult game={g} />
    </div>
  {:else}
    {#if view.simul}
      <div class="simul-area">
        <SimulBar
          simulId={view.simul.id}
          gameId={id}
          name={view.simul.name}
          hostName={view.simul.hostName}
          isHost={view.simul.hostId === auth.user?.id}
        />
      </div>
    {/if}

    <div class="game">
      <div class="name-area">
        <NameCard
          players={p}
          clock={g.clock as any}
          variant={g.variant}
          {orientation}
        />
      </div>

      <div class="board-area">
        <Board
          game={g}
          {myColor}
          {orientation}
          {resetKey}
          viewPly={viewPly ?? g.ply}
          onMove={sendMove}
          onCancel={() => resetKey++}
        />
      </div>

      <div class="sidebar-area">
        <GameSidebar
          game={g}
          players={p}
          {myColor}
          sanByPly={view.sanByPly}
          {viewPly}
          serverOffset={view.serverOffset}
          {id}
          onNav={nav}
          onSelect={(ply: number) => (viewPly = selectPly(ply, g.ply))}
          onDone={store.resync}
        />
      </div>
    </div>
  {/if}
{/if}