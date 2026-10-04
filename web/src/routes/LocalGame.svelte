<script lang="ts">
  import { onMount } from "svelte";
  import {
    abort,
    acceptDraw,
    applyMove,
    claimTimeout,
    inFirstMoveWindow,
    offerDraw,
    resign,
    sanForNextMove,
    type ActionResult,
    type Color,
    type GameState,
  } from "@lilchess/shared";
  import { navigate } from "../lib/router.svelte";
  import {
    loadLocalGame,
    saveLocalGame,
    startLocalGame,
    type LocalSave,
  } from "../lib/game/localGame";
  import Board from "../lib/components/Board.svelte";
  import Clock from "../lib/components/Clock.svelte";
  import MoveList from "../lib/components/MoveList.svelte";
  import MoveNav from "../lib/components/MoveNav.svelte";
  import { playSound } from "../lib/audio/audio";
  import { resultText } from "../lib/format";

  let save = $state<LocalSave | null>(loadLocalGame());
  let resetKey = $state(0);
  let autoFlip = $state(false);
  let flipped = $state(false);
  let viewPly = $state<number | null>(null);

  onMount(() => {
    if (!save) navigate("/");

    const t = setInterval(() => {
      const g = save?.game;

      if (
        g &&
        g.status === "started" &&
        g.ply > 0 &&
        !inFirstMoveWindow(g) &&
        Date.now() >= g.deadlineAt
      ) {
        commit(claimTimeout(g, Date.now()));
      }
    }, 200);

    return () => clearInterval(t);
  });

  function commit(res: ActionResult, san?: string | null) {
    if (!save) return;

    if (!res.ok) {
      resetKey++;
      return;
    }

    const moved = res.state.moves.length > save.game.moves.length;

    save = {
      ...save,
      game: res.state,
      sans: moved && san ? [...save.sans, san] : save.sans,
    };

    viewPly = null;

    if (res.state.status === "finished") {
      playSound("gameEnd");
    }

    saveLocalGame(save);
  }

  function onMove(uci: string) {
    if (!save) return;

    const res = applyMove(save.game, uci, Date.now());
    const san = sanForNextMove(save.game, uci);

    if (res.ok) {
      if (san === "O-O" || san === "O-O-O") {
        playSound("castle");
      } else if (san?.endsWith("+")) {
        playSound("check");
      } else if (san?.includes("x")) {
        playSound("capture");
      } else {
        playSound("move");
      }
    }

    commit(res, san);
  }

  function act(fn: (g: GameState) => ActionResult) {
    if (save) commit(fn(save.game));
  }

  function drawByAgreement(g: GameState): ActionResult {
    const offered = offerDraw(g, "white");
    return offered.ok ? acceptDraw(offered.state, "black") : offered;
  }

  function rematch() {
    if (!save) return;

    save = startLocalGame(save.config);
    viewPly = null;
    playSound("gameStart");
    resetKey++;
  }

  function nav(action: "prev" | "next" | "first" | "last") {
    if (!save) return;

    const total = save.game.ply;
    const current = viewPly ?? total;

    switch (action) {
      case "first":
        viewPly = 0;
        break;
      case "prev":
        viewPly = Math.max(0, current - 1);
        break;
      case "next":
        viewPly = current >= total - 1 ? null : current + 1;
        break;
      case "last":
        viewPly = null;
        break;
    }
  }

  function selectPly(ply: number) {
    if (!save) return;

    viewPly = ply === save.game.ply ? null : ply;
  }

  const sanByPly: Record<number, string> = $derived(
    Object.fromEntries((save?.sans ?? []).map((s, i) => [i + 1, s])),
  );

  const orientation: Color = $derived(
    autoFlip
      ? (save?.game.turn ?? "white")
      : flipped
        ? "black"
        : "white",
  );

  const opponentColor: Color = $derived(
    orientation === "white" ? "black" : "white",
  );

  const playerColor: Color = $derived(orientation);

  const label = (c: Color) => (c === "white" ? "White" : "Black");
</script>

{#if save}
  {@const g = save.game}

  <div class="game">
    <div class="name-area">
      <div class="name-card">
        <div class="title">
          {#if
            g.clock.mode === "live" &&
            g.clock.initialMs !== undefined &&
            g.clock.incrementMs !== undefined &&
            save.timed
          }
            {Math.floor(g.clock.initialMs / 60000)}+{Math.floor(g.clock.incrementMs / 1000)}
          {:else}
            Untimed
          {/if}
        </div>

        <div class="players">
          <div class="player">
            <span>{orientation === "white" ? "⚫" : "⚪"}</span>
            <span>{label(opponentColor)}</span>
          </div>

          <div class="player">
            <span>{orientation === "white" ? "⚪" : "⚫"}</span>
            <span>{label(playerColor)}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="board-area">
      <Board
        game={g}
        myColor={g.turn}
        {orientation}
        {resetKey}
        viewPly={viewPly ?? g.ply}
        {onMove}
        onCancel={() => resetKey++}
      />
    </div>

    <div class="sidebar-area">
      <aside class="sidebar">
        {#if save.timed}
          <div class="slot clock-slot">
            <Clock game={g} side={opponentColor} offset={0} />
          </div>
        {/if}

        <div class="slot nav-slot">
          <MoveNav {viewPly} total={g.ply} onNav={nav} />
        </div>

        <div class="moves-box">
          <div class="player-name">{label(opponentColor)}</div>

          <MoveList
            {sanByPly}
            ply={g.ply}
            selected={viewPly}
            onSelect={selectPly}
          />

          <div class="player-name">{label(playerColor)}</div>
        </div>

        {#if g.status === "started"}
          <div class="bar">
            <button
              title="Draw by agreement"
              aria-label="Draw by agreement"
              onclick={() => act(drawByAgreement)}>½</button>

            {#if g.ply <= 1}
              <button
                title="Abort game"
                aria-label="Abort game"
                onclick={() => act(abort)}>✕</button>
            {/if}

            <button
              title="Flip board"
              aria-label="Flip board"
              disabled={autoFlip}
              onclick={() => (flipped = !flipped)}>⇅</button>

            <button
              class="danger"
              title="White resigns"
              aria-label="White resigns"
              onclick={() => act((x) => resign(x, "white"))}>⚐ W</button>

            <button
              class="danger"
              title="Black resigns"
              aria-label="Black resigns"
              onclick={() => act((x) => resign(x, "black"))}>⚑ B</button>
          </div>

          <label class="opt">
            <input type="checkbox" bind:checked={autoFlip} />
            Auto-flip board each move
          </label>
        {:else}
          <div class="finished">
            <p class="result">{resultText(g)}</p>

            <div class="row">
              <button class="primary" onclick={rematch}>Rematch</button>
              <a href="#/">Back to lobby</a>
            </div>
          </div>
        {/if}

        {#if save.timed}
          <div class="slot clock-slot">
            <Clock game={g} side={playerColor} offset={0} />
          </div>
        {/if}
      </aside>
    </div>
  </div>
{/if}

<style>
  /* Name card (unchanged apart from dropping the border to match the sidebar panel) */
  .name-card {
    width: 100%;
    padding: 0.75rem 1rem;
    background: var(--panel);
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

  /* One attached panel, same structure as GameSidebar.svelte */
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
  }

  /* Icon bar, same look as GameActions.svelte */
  .bar {
    display: flex;
    background: var(--panel-hi);
    border-top: 1px solid var(--border);
  }
  .bar button {
    flex: 1;
    padding: 0.55rem 0;
    background: transparent;
    border-radius: 0;
    font-size: 1rem;
    line-height: 1.2;
  }
  .bar button:hover:not(:disabled) { background: #3a3835; }
  .bar button.danger:hover:not(:disabled) { background: var(--red); }

  .opt {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.4rem 0.75rem;
    background: var(--panel-hi);
    border-top: 1px solid var(--border);
    color: var(--muted);
    font-size: 0.85rem;
    cursor: pointer;
  }

  .finished {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem;
    background: var(--panel-hi);
    border-top: 1px solid var(--border);
  }

  .result {
    color: var(--text-hi);
    font-weight: 500;
    margin: 0;
  }
</style>