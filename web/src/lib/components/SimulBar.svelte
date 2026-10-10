<script lang="ts">
  import { onDestroy } from "svelte";
  import { adjacentBoard, nextBoardForHost } from "@lilchess/shared";
  import { displayName } from "../format";
  import { navigate } from "../router.svelte";
  import { acquireSimulStore } from "../simul/simulStore.svelte";

  let { simulId, gameId, name, hostName, isHost }: {
    simulId: string; gameId: string; name: string; hostName: string; isHost: boolean;
  } = $props();

  // App.svelte wraps Game in {#key id}, so the initial ids are the right ones for this instance.
  // svelte-ignore state_referenced_locally
  const lease = acquireSimulStore(simulId);
  onDestroy(lease.release);
  const view = lease.store.view;

  function readAuto(): boolean {
    try { return localStorage.getItem("simul.autoAdvance") !== "0"; } catch { return true; }
  }
  let autoAdvance = $state(readAuto());
  function setAuto(on: boolean) {
    autoAdvance = on;
    try { localStorage.setItem("simul.autoAdvance", on ? "1" : "0"); } catch { /* private mode */ }
  }

  const boards = $derived(view.detail?.boards ?? []);
  const states = $derived(boards.map((b) => ({
    gameId: b.gameId, seat: b.seat, hostColor: b.hostColor, status: b.status, turn: b.turn, deadlineAt: b.deadlineAt,
  })));
  const here = $derived(boards.find((b) => b.gameId === gameId));
  const left = $derived(states.filter((b) => b.status === "started").length);
  const toMove = $derived(states.filter((b) => b.status === "started" && b.turn === b.hostColor).length);
  const nextId = $derived(nextBoardForHost(states, gameId));

  const go = (id: string | null) => { if (id) navigate(`/game/${id}`); };

  // When the host's move on this board has been played, jump to the most urgent board.
  let wasMyTurn: boolean | null = null;
  $effect(() => {
    if (!isHost || !here || here.status !== "started") { wasMyTurn = null; return; }
    const myTurn = here.turn === here.hostColor;
    if (wasMyTurn === true && !myTurn && autoAdvance) go(nextBoardForHost(states, gameId));
    wasMyTurn = myTurn;
  });
</script>

<div class="simul-bar">
  <a class="title" href={"#/simul/" + simulId}>{name}</a>
  {#if isHost}
    <div class="controls">
      <button class="compact step" aria-label="Previous board" onclick={() => go(adjacentBoard(states, gameId, -1))}>‹</button>
      <span class="count">{here ? `Board ${here.seat} · ` : ""}{left} left · {toMove} to move</span>
      <button class="compact step" aria-label="Next board" onclick={() => go(adjacentBoard(states, gameId, 1))}>›</button>
      <button disabled={!nextId} onclick={() => go(nextId)}>Next to move</button>
      <label class="opt"><input type="checkbox" checked={autoAdvance} onchange={(e) => setAuto(e.currentTarget.checked)} /> Auto-advance</label>
    </div>
  {:else}
    <span class="muted">Simul by {displayName(hostName)} · {left} {left === 1 ? "board" : "boards"} left</span>
  {/if}
</div>

<style>
  .simul-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 1rem; padding: 0.5rem 0.75rem;
               margin-bottom: 0.75rem; background: var(--panel); border-radius: var(--radius); }
  .title { font-weight: 600; color: var(--text-hi); }
  .controls { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
  .step { width: 2.25rem; padding: 0.3rem 0; }
  .count { color: var(--muted); font-size: 0.9rem; white-space: nowrap; }
  .opt { display: flex; align-items: center; gap: 0.35rem; color: var(--muted); font-size: 0.9rem; }
</style>