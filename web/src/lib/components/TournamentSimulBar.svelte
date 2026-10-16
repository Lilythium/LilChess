<script lang="ts">
  import type { TournamentSimulInfo } from "../types";
  import { navigate } from "../router.svelte";
  import {
    boardsForCurrentGame,
    manuallyNavigateAdjacentTournamentBoard,
    nextTournamentSimulBoard,
    tournamentSimulCounts,
  } from "../game/tournamentSimulNavigation";

  let {
    simul,
    gameId,
    gameTurn,
    gameStatus,
    gameDeadlineAt,
    autoAdvance,
    onAutoAdvanceChange,
  }: {
    simul: TournamentSimulInfo;
    gameId: string;
    gameTurn: "white" | "black";
    gameStatus: "started" | "finished" | "aborted";
    gameDeadlineAt: number;
    autoAdvance: boolean;
    onAutoAdvanceChange: (enabled: boolean) => void;
  } = $props();

  const boards = $derived(boardsForCurrentGame(simul.boards, gameId, gameTurn, gameStatus, gameDeadlineAt));
  const here = $derived(boards.find((board) => board.gameId === gameId));
  const counts = $derived(tournamentSimulCounts(boards));
  const nextId = $derived(nextTournamentSimulBoard(boards, gameId));
  const go = (id: string | null) => { if (id) navigate(`/game/${id}`); };
  const goAdjacent = (delta: 1 | -1) =>
    manuallyNavigateAdjacentTournamentBoard(boards, gameId, delta, (nextId) => navigate(`/game/${nextId}`));
</script>

<div class="simul-bar">
  <a class="title" href={`#/tournament/${simul.tournamentId}`}>{simul.tournamentName} · Simul²</a>
  <div class="controls">
    <button class="compact step" aria-label="Previous board" onclick={() => goAdjacent(-1)}>‹</button>
    <span class="count">{here ? `Board ${here.seat} · ` : ""}{counts.left} left · {counts.toMove} to move</span>
    <button class="compact step" aria-label="Next board" onclick={() => goAdjacent(1)}>›</button>
    <button disabled={!nextId} onclick={() => go(nextId)}>Next to move</button>
    <label class="opt"><input type="checkbox" checked={autoAdvance} onchange={(e) => onAutoAdvanceChange(e.currentTarget.checked)} /> Auto-advance</label>
  </div>
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
