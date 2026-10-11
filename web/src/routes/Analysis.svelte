<script lang="ts">
  import { onMount } from "svelte";
  import {
    PositionTimeline, START_FEN, classifyGame, formatScore, gameAccuracy, summariseVerdicts, terminalScore,
    type Color, type MoveClass,
  } from "@lilchess/shared";
  import { api } from "../lib/api";
  import { auth } from "../lib/auth.svelte";
  import type { AnalysisResponse } from "../lib/types";
  import { browserCache } from "../lib/analysis/cache";
  import { parseAnalysisInput } from "../lib/analysis/importText";
  import { gameCacheKey, type LoadedGame } from "../lib/analysis/loadedGame";
  import { displayName } from "../lib/format";
  import { selectPly, stepView, type NavAction } from "../lib/game/history";
  import { commonPrefix, playOnLine } from "../lib/analysis/line";
  import { createAnalysisSession } from "../lib/analysis/analysisSession.svelte";
  import AnalysisBoard from "../lib/components/AnalysisBoard.svelte";
  import AnalysisPanel from "../lib/components/AnalysisPanel.svelte";
  import EngineLines from "../lib/components/EngineLines.svelte";
  import EvalBar from "../lib/components/EvalBar.svelte";
  import LoadPositionPanel from "../lib/components/LoadPositionPanel.svelte";
  import MoveList from "../lib/components/MoveList.svelte";
  import MoveNav from "../lib/components/MoveNav.svelte";

  // App.svelte wraps this in {#key id}, so capturing the initial id is intended.
  // svelte-ignore state_referenced_locally
  let { id, imported = false }: { id?: string; imported?: boolean } = $props();
  // svelte-ignore state_referenced_locally
  const gameId = id;
  // Imported games share the page but not the id space, so their cached analysis gets its own keys.
  // svelte-ignore state_referenced_locally
  const cacheId = id && imported ? `imported:${id}` : id;
  
  const session = createAnalysisSession();
  const s = session.view;
  const cache = browserCache();

  // ---- the game on the board: stored on the server, pasted in, or none (free board) ----
  let loaded = $state<LoadedGame | null>(null);
  let loadError = $state<string | null>(null);
  let loading = $state(!!gameId);

  const initialFen = $derived(loaded?.initialFen ?? START_FEN);
  const chess960 = $derived(loaded?.variant === "chess960");
  const gameMoves = $derived(loaded?.moves ?? []);

  // Every position of the game, built once. The full-game run and the move marks use it.
  const gameTimeline = $derived.by(() => {
    if (!loaded) return null;
    try {
      const tl = new PositionTimeline(loaded.initialFen);
      return tl.sync(loaded.moves) ? tl : null;
    } catch {
      return null;
    }
  });

  // ---- the line on the board: starts as the game, becomes a sideline when the user plays on ----
  let line = $state<string[]>([]);
  let viewPly = $state<number | null>(null); // null = end of the line
  let flipped = $state(false);

  let lineTimeline: PositionTimeline | null = null; // extended in place, never rebuilt per step
  const lineView = $derived.by(() => {
    if (!lineTimeline || lineTimeline.initialFen !== initialFen) lineTimeline = new PositionTimeline(initialFen);
    lineTimeline.sync(line);
    return { fens: lineTimeline.fens, sans: lineTimeline.sans, squares: lineTimeline.squares, length: lineTimeline.length };
  });

  const total = $derived(lineView.length);
  const ply = $derived(viewPly ?? total);
  const viewFen = $derived(lineView.fens[ply] ?? initialFen);
  const lastMove = $derived(lineView.squares[ply] ?? null);
  const sanByPly = $derived(Object.fromEntries(lineView.sans.map((san, i) => [i + 1, san])));

  const prefix = $derived(commonPrefix(line, gameMoves)); // plies still identical to the game
  const showReset = $derived(line.length > 0 && !(line.length === gameMoves.length && prefix === line.length));
  const moveEvaluations = $derived.by(() => Object.fromEntries(
    s.full.evals.slice(1, prefix + 1).flatMap((evaluation, i) =>
      evaluation ? [[i + 1, formatScore(evaluation.score)]] : [],
    ),
  ));

  const baseOrientation = $derived<Color>(
    loaded?.black && auth.user && loaded.black.toLowerCase() === auth.user.username.toLowerCase() ? "black" : "white",
  );
  const orientation = $derived<Color>(
    flipped ? (baseOrientation === "white" ? "black" : "white") : baseOrientation,
  );

  // ---- evaluation ----
  const terminal = $derived(terminalScore(viewFen));
  const liveLines = $derived(s.live.fen === viewFen ? s.live.lines : []);
  const mainEval = $derived(ply <= prefix ? s.full.evals[ply] : undefined); // stored eval only on the game line
  const viewScore = $derived(terminal ?? liveLines[0]?.score ?? mainEval?.score);
  const bestUci = $derived(terminal ? null : (liveLines[0]?.pv[0] ?? mainEval?.best ?? null));
  const arrow = $derived<[string, string] | null>(
    s.enabled && bestUci ? [bestUci.slice(0, 2), bestUci.slice(2, 4)] : null,
  );

  const verdicts = $derived(
    gameTimeline ? classifyGame(gameTimeline.fens, gameTimeline.moves, s.full.evals) : [],
  );
  const marks = $derived.by(() => {
    const out: Record<number, MoveClass> = {};
    verdicts.forEach((v, i) => { if (v && i + 1 <= prefix) out[i + 1] = v.cls; });
    return out;
  });
  const finishedRun = $derived(
    !s.full.running && s.full.evals.length > 0 && s.full.evals.every(Boolean),
  );
  const summary = $derived(finishedRun ? summariseVerdicts(verdicts) : null);
  const accuracy = $derived(finishedRun ? gameAccuracy(verdicts) : null);

  let depth = $state(14);

  // Live analysis follows the position on screen, after a short pause so scrubbing doesn't thrash the engine.
  $effect(() => {
    const fen = viewFen;
    const on = s.enabled;
    const running = s.full.running;
    const done = terminal !== null;
    if (!on || running) return;
    if (done) { session.clearLive(fen); return; }
    const timer = setTimeout(() => void session.analysePosition(fen, chess960), 150);
    return () => clearTimeout(timer);
  });

  // Opens a game on the board and restores its saved analysis, if this browser has one.
  function openGame(game: LoadedGame) {
    session.resetFull(); // also stops any run still going for the previous game
    loaded = game;
    line = [...game.moves];
    viewPly = null;
    flipped = false;
    const hit = cache.load(gameCacheKey(cacheId, game), game.moves.length + 1);
    if (hit) {
      session.loadFull(hit.evals);
      depth = hit.depth;
    }
  }

  async function runAnalysis() {
    if (!gameTimeline || !loaded) return;
    const key = gameCacheKey(cacheId, loaded);
    const ranAt = depth;
    await session.runFull(gameTimeline.fens, chess960, ranAt);
    // Only a finished run for the game still on screen is worth keeping.
    if (loaded && gameCacheKey(cacheId, loaded) === key) cache.save(key, ranAt, s.full.evals);
  }

  function loadText(text: string): { error?: string; note?: string } {
    const parsed = parseAnalysisInput(text);
    if (!parsed.ok) return { error: parsed.error };
    openGame(parsed.game);
    return parsed.gamesFound > 1 ? { note: `Loaded the first of ${parsed.gamesFound} games.` } : {};
  }

  function playMove(uci: string) {
    const next = playOnLine(line, ply, uci, viewFen);
    if (next !== line) line = next;
    viewPly = selectPly(ply + 1, next.length);
  }

  function nav(action: NavAction) {
    viewPly = stepView(viewPly, total, action);
  }

  function onWheel(e: WheelEvent) {
    const target = e.target;
    if (
      e.ctrlKey ||
      e.deltaY === 0 ||
      total === 0 ||
      (target instanceof HTMLElement &&
        (["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName) ||
          target.isContentEditable))
    ) {
      return;
    }

    const currentPly = viewPly ?? total;
    const nextPly = currentPly + (e.deltaY > 0 ? 1 : -1);
    if (nextPly < 0 || nextPly > total) return;

    e.preventDefault();
    viewPly = selectPly(nextPly, total);
  }

  function resetToGame() {
    line = [...gameMoves];
    viewPly = null;
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
    if (gameId) {
      api<AnalysisResponse>(`/api/games/${gameId}/analysis`)
        .then((body) => openGame(body))
        .catch((err) => {
          loadError = err instanceof Error && err.message === "game_not_finished"
            ? "Games can be analysed once they are finished."
            : imported ? "Couldn't load this imported game." : "Couldn't load this game.";
        })
        .finally(() => (loading = false));
    }
    return () => session.dispose();
  });
</script>

<svelte:window onkeydown={onKey} onwheel={onWheel} />
<svelte:head><title>Analysis</title></svelte:head>

{#if loading}
  <p class="muted">Loading…</p>
{:else}
  {#if loadError}<p class="error" role="alert">{loadError} The analysis board below still works.</p>{/if}

  <div class="analysis">
    <div class="board-col">
      <div class="bar-slot"><EvalBar score={viewScore} {orientation} /></div>
      <AnalysisBoard fen={viewFen} {orientation} {lastMove} {arrow} {chess960} onMove={playMove} />
    </div>

    <aside class="side">
      <h2 class="title">
        {#if loaded && (loaded.white || loaded.black)}
          {displayName(loaded.white ?? "White")} vs {displayName(loaded.black ?? "Black")}
          <small>{loaded.result ?? ""}{loaded.termination ? ` · ${loaded.termination.replace(/_/g, " ")}` : ""}</small>
        {:else if loaded}
          {loaded.moves.length ? "Pasted game" : "Pasted position"}
        {:else}
          Analysis board
        {/if}
      </h2>

      <AnalysisPanel
        enabled={s.enabled}
        autoOff={s.autoOff}
        status={s.status}
        error={s.error}
        hasGame={gameTimeline !== null}
        running={s.full.running}
        done={s.full.done}
        total={s.full.total}
        {depth}
        {summary}
        {accuracy}
        onToggle={(on) => session.setEnabled(on)}
        onDepth={(d) => (depth = d)}
        onRun={() => void runAnalysis()}
        onCancel={() => session.cancelFull()}
      />

      {#if !gameId || loadError}<LoadPositionPanel onLoad={loadText} />{/if}

      {#if s.enabled && s.status !== "error"}
        <EngineLines
          lines={s.full.running ? [] : liveLines}
          fen={viewFen}
          depth={s.live.fen === viewFen ? s.live.depth : 0}
          searching={s.full.running ? false : s.live.fen === viewFen && s.live.searching}
          onPlay={playMove}
        />
      {/if}

      <div class="moves">
        <MoveNav viewPly={viewPly} {total} onNav={nav} />
        <MoveList {sanByPly} ply={total} selected={viewPly} {marks} evaluations={moveEvaluations} onSelect={(p) => (viewPly = selectPly(p, total))} />
      </div>

      <div class="actions">
        <button type="button" onclick={() => (flipped = !flipped)}>Flip board</button>
        {#if showReset}<button type="button" onclick={resetToGame}>{gameId || loaded?.moves.length ? "Back to game" : "Reset board"}</button>{/if}
        {#if gameId}<a href={`#/game/${gameId}`}>Game page</a>{/if}
      </div>
    </aside>
  </div>
{/if}

<style>
  :global(.page:has(.analysis)) { max-width: 1400px; }

  .analysis {
    --side-w: 360px;
    --bar-w: 28px;
    --gap: 1rem;
    --board: min(
      720px,
      calc(100cqw - var(--side-w) - var(--bar-w) - 6px - 2 * var(--gap)),
      max(320px, calc(100dvh - var(--header-h) - 2rem)));
    display: grid;
    grid-template-columns: calc(var(--bar-w) + 6px + var(--board)) var(--side-w);
    gap: var(--gap);
    justify-content: center;
    align-items: start;
  }
  .board-col { display: grid; grid-template-columns: var(--bar-w) var(--board); gap: 6px; align-items: stretch; }
  .bar-slot { min-height: 0; }
  .side { display: flex; flex-direction: column; gap: 0.75rem; min-width: 0; }
  .title { margin: 0; font-size: 1.1rem; }
  .title small { display: block; color: var(--muted); font-weight: 400; font-size: 0.8rem; }
  .moves { background: var(--panel); border-radius: var(--radius); overflow: hidden; }
  .actions { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }

  @media (max-width: 800px) {
    .analysis {
      --board: min(calc(100cqw - var(--bar-w) - 6px), calc(100dvh - 300px));
      display: flex; flex-direction: column; align-items: center;
    }
    .side { width: 100%; }
  }
</style>
