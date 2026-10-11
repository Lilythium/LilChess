<script lang="ts">
  import { onDestroy } from "svelte";
  import { Chessground } from "chessground";
  import type { Api } from "chessground/api";
  import type { Key } from "chessground/types";
  import { Chess } from "chessops/chess";
  import { chessgroundDests } from "chessops/compat";
  import { parseFen } from "chessops/fen";
  import { parseSquare, squareRank } from "chessops/util";
  import type { Color } from "@lilchess/shared";
  import PromotionDialog from "./PromotionDialog.svelte";

  let { fen, orientation, lastMove = null, arrow = null, chess960 = false, onMove }: {
    fen: string;
    orientation: Color;
    lastMove?: [string, string] | null;
    arrow?: [string, string] | null; // the engine's suggestion
    chess960?: boolean;
    onMove: (uci: string) => void;
  } = $props();

  let el: HTMLDivElement;
  let cg: Api | undefined;
  let position: Chess | null = null; // current position, for promotion detection
  let promo = $state<{ orig: Key; dest: Key } | null>(null);

  $effect(() => {
    const setup = parseFen(fen);
    if (setup.isErr) return;
    const parsed = Chess.fromSetup(setup.value);
    if (parsed.isErr) return;
    const pos = parsed.value;
    position = pos;

    const api = (cg ??= Chessground(el, {
      premovable: { enabled: false },
      movable: { free: false, events: { after: handleAfter } },
      drawable: { enabled: true },
    }));
    api.set({
      fen,
      orientation,
      turnColor: pos.turn,
      check: pos.isCheck(),
      lastMove: lastMove ? [lastMove[0] as Key, lastMove[1] as Key] : undefined,
      movable: { color: pos.turn, dests: chessgroundDests(pos, { chess960 }) },
      drawable: { autoShapes: arrow ? [{ orig: arrow[0] as Key, dest: arrow[1] as Key, brush: "green" }] : [] },
    });
  });

  function handleAfter(orig: Key, dest: Key) {
    const from = parseSquare(orig);
    const to = parseSquare(dest);
    if (from === undefined || to === undefined || !position) return;
    const isPawn = position.board.get(from)?.role === "pawn";
    const rank = squareRank(to);
    if (isPawn && (rank === 0 || rank === 7)) promo = { orig, dest };
    else onMove(orig + dest);
  }

  function pick(role: "q" | "r" | "b" | "n") {
    if (promo) onMove(promo.orig + promo.dest + role);
    promo = null;
  }

  function cancelPromo() {
    promo = null;
    // Put the pawn back: re-apply the current position.
    cg?.set({ fen });
  }

  onDestroy(() => cg?.destroy());
</script>

<div class="wrap">
  <div bind:this={el} class="board"></div>
  {#if promo}<PromotionDialog onPick={pick} onCancel={cancelPromo} />{/if}
</div>

<style>
  .wrap { position: relative; width: 100%; container-type: inline-size; }
  .board {
    width: 100%; aspect-ratio: 1; touch-action: none; container-type: inline-size;
    user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent;
    --coord-light: rgba(255, 255, 255, 0.85);
    --coord-dark: rgba(72, 72, 72, 0.85);
  }
  /* Coordinate styling is the same as Board.svelte: ranks top-left, files bottom-right of each square. */
  .board :global(coords) { font-size: clamp(9px, 1.9cqw, 15px); font-weight: 600; }
  .board :global(coords.ranks) { top: 0; left: 0; right: auto; width: auto; height: 100%; }
  .board :global(coords.ranks coord) { flex: 1 1 0; transform: none; display: flex; align-items: flex-start; padding: 0.2em 0 0 0.35em; }
  .board :global(coords.files) { bottom: 0; left: 0; right: auto; width: 100%; height: auto; text-align: right; }
  .board :global(coords.files coord) {
    flex: 1 1 0; transform: none; display: flex; align-items: flex-end; justify-content: flex-end;
    padding: 0 0.35em 0.2em 0; text-transform: lowercase;
  }
  .board :global(coords.ranks:not(.black) coord:nth-child(odd)),
  .board :global(coords.ranks.black coord:nth-child(even)),
  .board :global(coords.files:not(.black) coord:nth-child(odd)),
  .board :global(coords.files.black coord:nth-child(even)) { color: var(--coord-light); }
  .board :global(coords.ranks:not(.black) coord:nth-child(even)),
  .board :global(coords.ranks.black coord:nth-child(odd)),
  .board :global(coords.files:not(.black) coord:nth-child(even)),
  .board :global(coords.files.black coord:nth-child(odd)) { color: var(--coord-dark); }
</style>
