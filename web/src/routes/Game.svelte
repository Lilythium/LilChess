<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { auth } from "../lib/auth.svelte";
  import { createGameStore } from "../lib/game/gameStore.svelte";
  import { connectGameSocket, type SocketStatus } from "../lib/ws/gameSocket";
  import ConnectionBanner from "../lib/components/ConnectionBanner.svelte";
  import Board from "../lib/components/Board.svelte";
  import NameCard from "../lib/components/NameCard.svelte";
  import GameSidebar from "../lib/components/GameSidebar.svelte";
  import { selectPly, stepView, type NavAction } from "../lib/game/history";
  import { playMoveSound, playSound } from "../lib/audio/audio";
  import { nextBoardForHost, type Color, type GameState } from "@lilchess/shared";
  import { viewport } from "../lib/viewport.svelte";
  import { gameTitle } from "../lib/format";
  import PlayerStrip from "../lib/components/PlayerStrip.svelte";
  import MoveStrip from "../lib/components/MoveStrip.svelte";
  import GameActions from "../lib/components/GameActions.svelte";
  import GameAlerts from "../lib/components/GameAlerts.svelte";
  import GameResult from "../lib/components/GameResult.svelte";
  import { keepAwake } from "../lib/wakeLock";
  import SimulBar from "../lib/components/SimulBar.svelte";
  import TournamentSimulBar from "../lib/components/TournamentSimulBar.svelte";
  import { consumeNewGameSound, navigate } from "../lib/router.svelte";
  import { resyncAndAdvanceAfterHostMove } from "../lib/game/tournamentSimulNavigation";

  let { id }: { id: string } = $props();

  // App.svelte wraps this component in {#key id}, so capturing the initial id is intended.
  // svelte-ignore state_referenced_locally
  const store = createGameStore(id);
  const view = store.view;
  const isTournamentSimulHost = $derived(
    Boolean(view.tournamentSimul && auth.user && view.tournamentSimul.hostId === auth.user.id),
  );

  let resetKey = $state(0);
  let socketStatus = $state<SocketStatus>("connecting");
  let socketHandle: ReturnType<typeof connectGameSocket> | null = null;
  function readAutoAdvance(): boolean {
    try { return localStorage.getItem("simul.autoAdvance") !== "0"; } catch { return true; }
  }
  let autoAdvance = $state(readAutoAdvance());
  function setAutoAdvance(on: boolean) {
    autoAdvance = on;
    try { localStorage.setItem("simul.autoAdvance", on ? "1" : "0"); } catch { /* private mode */ }
  }

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
      setViewPly(stepView(viewPly, view.game.ply, action));
    }
  }

  function setViewPly(nextPly: number | null) {
    const game = view.game;
    if (game) {
      const current = viewPly ?? game.ply;
      const next = nextPly ?? game.ply;
      if (next > current) {
        const san = view.sanByPly[next];
        if (san) playMoveSound(san);
      }
    }
    viewPly = nextPly;
  }

  function onWheel(e: WheelEvent) {
    const target = e.target;
    if (
      e.ctrlKey ||
      e.deltaY === 0 ||
      (target instanceof HTMLElement &&
        (["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName) ||
          target.isContentEditable))
    ) {
      return;
    }

    const game = view.game;
    if (!game) return;

    const currentPly = viewPly ?? game.ply;
    const nextPly = currentPly + (e.deltaY > 0 ? 1 : -1);
    if (nextPly < 0 || nextPly > game.ply) return;

    e.preventDefault();
    setViewPly(selectPly(nextPly, game.ply));
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
    if (consumeNewGameSound(id)) playSound("gameStart");

    const sock = connectGameSocket(id, {
      onEvent: store.applyEvent,
      onResyncNeeded: () => void store.resync(),
      onStatusChange: (s) => (socketStatus = s),
    });

    socketHandle = sock;

    return () => {
      socketHandle = null;
      sock.close();
    };
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

  $effect(() => {
    if (!isTournamentSimulHost) return;

    const interval = setInterval(() => {
      if (!document.hidden) void store.resyncTournamentSimul();
    }, 3000);
    return () => clearInterval(interval);
  });

  async function sendMove(uci: string) {
    if (!view.game) return;
    const board = view.tournamentSimul?.boards.find((candidate) => candidate.gameId === id);
    const gameTurn = view.game.turn;
    const advanceEnabled = autoAdvance;

    try {
      await api(`/api/games/${id}/move`, {
        body: {
          ply: view.game.ply,
          uci,
        },
      });

      if (view.tournamentSimul) {
        await resyncAndAdvanceAfterHostMove({
          autoAdvance: advanceEnabled,
          hostColor: board?.hostColor,
          gameTurn,
          gameId: id,
          refresh: async () => {
            await store.resync();
            return view.status === "ready";
          },
          getBoards: () => view.tournamentSimul?.boards ?? [],
          navigate: (nextId) => navigate(`/game/${nextId}`),
        });
      } else if (socketStatus !== "open") {
        await store.resync();
      }
    } catch {
      await store.resync();
      resetKey++;
    }
  }
</script>

<svelte:window onkeydown={onKey} onwheel={onWheel} />

<svelte:head>
  {#if view.game && view.players}
    <title>{gameTitle(view.game.clock, view.game.variant)}</title>
  {/if}
</svelte:head>

<!-- Only a game in progress needs a live connection; a finished one is complete in the REST response. -->
<ConnectionBanner
  status={view.game && view.game.status !== "started" ? "open" : socketStatus}
  onRetry={() => socketHandle?.retry()}
/>

{#if view.status === "loading"}
  <p class="muted">Loading…</p>
{:else if view.status === "error"}
  <p class="error">{view.error}</p>
{:else if view.game && view.players}
  {@const g = view.game}
  {@const p = view.players}

  {#if viewport.mobile}
    <div class="game-mobile" style:--simul-h={view.simul || view.tournamentSimul ? "56px" : "0px"}>
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
      {:else if view.tournamentSimul}
        <div class="simul-area">
          <TournamentSimulBar
            simul={view.tournamentSimul}
            gameId={id}
            gameTurn={g.turn}
            gameStatus={g.status}
            gameDeadlineAt={g.deadlineAt}
            {autoAdvance}
            onAutoAdvanceChange={setAutoAdvance}
          />
        </div>
      {/if}

      <div class="strip-top">
        <PlayerStrip
          color={topColor}
          {...side(topColor)}
          game={g}
          offset={view.serverOffset}
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

      <div class="strip-bottom">
        <PlayerStrip
          color={bottomColor}
          {...side(bottomColor)}
          game={g}
          offset={view.serverOffset}
        />
      </div>

      <div class="move-strip-area">
        <MoveStrip
          sanByPly={view.sanByPly}
          ply={g.ply}
          {viewPly}
          onNav={nav}
          onSelect={(ply: number) => setViewPly(selectPly(ply, g.ply))}
        />
      </div>

      <!-- app.css pins .dock to the bottom of the screen; the offer/warning alerts float just above it. -->
      <div class="dock">
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

        <GameResult game={g} {id} />
      </div>
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
    {:else if view.tournamentSimul}
      <div class="simul-area">
        <TournamentSimulBar
          simul={view.tournamentSimul}
          gameId={id}
          gameTurn={g.turn}
          gameStatus={g.status}
          gameDeadlineAt={g.deadlineAt}
          {autoAdvance}
          onAutoAdvanceChange={setAutoAdvance}
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
          onSelect={(ply: number) => setViewPly(selectPly(ply, g.ply))}
          onDone={store.resync}
        />
        {#if g.status === "finished"}
          <a class="analyse-link" href={`#/analysis/${id}`}>Analyse this game</a>
        {/if}
      </div>
    </div>
  {/if}
{/if}
<style>
  .analyse-link { display: block; margin-top: 0.75rem; text-align: center; }
</style>
