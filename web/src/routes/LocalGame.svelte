<script lang="ts">
  import { onMount } from "svelte";
  import {
    abort, acceptDraw, applyMove, claimTimeout, inFirstMoveWindow, offerDraw, resign, sanForNextMove,
    type ActionResult, type Color, type GameState,
  } from "@lilchess/shared";
  import { navigate } from "../lib/router.svelte";
  import { resultText } from "../lib/format";
  import { loadLocalGame, saveLocalGame, startLocalGame, type LocalSave } from "../lib/game/localGame";
  import Board from "../lib/components/Board.svelte";
  import Clock from "../lib/components/Clock.svelte";
  import MoveList from "../lib/components/MoveList.svelte";
  import { playSound } from "../lib/audio/audio";

  let save = $state<LocalSave | null>(loadLocalGame());
  let resetKey = $state(0);
  let autoFlip = $state(false);
  let flipped = $state(false);

  onMount(() => {
    if (!save) navigate("/");
    // No server here, so this page flags timeouts itself.
    const t = setInterval(() => {
      const g = save?.game;
      if (g && g.status === "started" && !inFirstMoveWindow(g) && Date.now() >= g.deadlineAt) {
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
    playSound("gameStart");
    resetKey++;
  }

  const sanByPly: Record<number, string> = $derived(
    Object.fromEntries((save?.sans ?? []).map((s, i) => [i + 1, s])),
  );
  const orientation: Color = $derived(autoFlip ? (save?.game.turn ?? "white") : flipped ? "black" : "white");
  const label = (c: Color) => (c === "white" ? "White" : "Black");
</script>

{#if save}
  {@const g = save.game}
  {@const bottom = orientation}
  {@const top = orientation === "white" ? "black" : "white"}

  <div class="game">
    <div class="board-col">
      <div class="bar">
        <span>{label(top)}</span>
        {#if save.timed}<Clock game={g} side={top} offset={0} />{/if}
      </div>

      <Board game={g} myColor={g.turn} {orientation} {resetKey} {onMove} onCancel={() => resetKey++} />

      <div class="bar">
        <span>{label(bottom)}</span>
        {#if save.timed}<Clock game={g} side={bottom} offset={0} />{/if}
      </div>
    </div>

    <div class="side panel">
      <MoveList {sanByPly} ply={g.ply} />

      <div class="actions">
        {#if g.status === "started"}
          <div class="row">
            <button onclick={() => act(drawByAgreement)}>Agree draw</button>
            {#if g.ply <= 1}<button onclick={() => act(abort)}>Abort</button>{/if}
            <button class="danger" onclick={() => act((x) => resign(x, "white"))}>White resigns</button>
            <button class="danger" onclick={() => act((x) => resign(x, "black"))}>Black resigns</button>
          </div>
          <div class="row" style="margin-top: .5rem">
            <button disabled={autoFlip} onclick={() => (flipped = !flipped)}>Flip board</button>
            <label><input type="checkbox" bind:checked={autoFlip} /> Auto-flip</label>
          </div>
        {:else}
          <p class="result">{resultText(g)}</p>
          <div class="row">
            <button class="primary" onclick={rematch}>Rematch</button>
            <a href="#/">Back to lobby</a>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}