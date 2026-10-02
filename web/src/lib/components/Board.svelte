<script lang="ts">
  import { untrack } from "svelte";
  import { Chessground } from "chessground";
  import type { Api } from "chessground/api";
  import type { Key, MoveMetadata } from "chessground/types";
  import { chessgroundDests } from "chessops/compat";
  import { makeFen } from "chessops/fen";
  import { parseSquare, squareRank } from "chessops/util";
  import { replay, type Color, type GameState } from "@lilchess/shared";
  import { boardMode } from "../game/boardMode";
  import { gameAtPly } from "../game/history";
  import PromotionDialog from "./PromotionDialog.svelte";

  let { game, myColor, orientation, resetKey, onMove, onCancel, viewPly = null }:
    { game: GameState; myColor: Color | null; orientation?: Color; resetKey: number;
      onMove: (uci: string) => void; onCancel: () => void;
      viewPly?: number | null } = $props(); // null = show the live position

  let el: HTMLDivElement;
  let cg: Api | undefined;
  let promo = $state<{ orig: Key; dest: Key } | null>(null);

  $effect(() => {
    void resetKey; // a bump forces a re-sync after a rejected/cancelled move
    const shown = gameAtPly(game, viewPly); // earlier position while browsing history
    const r = replay(shown);
    if (!r.ok) return;
    const pos = r.position;
    const last = shown.moves.at(-1);
    const mode = boardMode(game, myColor, shown === game);

    const api = (cg ??= Chessground(el, {
      premovable: { showDests: true, castle: true },
      movable: { free: false, events: { after: handleAfter } },
    }));
    api.set({
      fen: makeFen(pos.toSetup()),
      orientation: orientation ?? myColor ?? "white",
      turnColor: shown.turn,
      check: pos.isCheck(),
      lastMove: last ? [last.slice(0, 2) as Key, last.slice(2, 4) as Key] : undefined,
      premovable: { enabled: mode.premovesEnabled },
      movable: {
        color: mode.movableColor,
        dests: mode.movesEnabled ? chessgroundDests(pos) : new Map(),
      },
    });

    if (!mode.premovesEnabled) {
      api.cancelPremove(); // game ended, or the user is browsing history
    } else if (mode.movesEnabled) {
      // The opponent just moved: play any queued premove (dropped silently if illegal).
      // untrack: handleAfter -> onMove reads game state we don't want this effect to depend on.
      untrack(() => api.playPremove());
    }
  });

  function handleAfter(orig: Key, dest: Key, meta?: MoveMetadata) {
    const r = replay(game);
    if (!r.ok) return;
    const from = parseSquare(orig)!;
    const isPawn = r.position.board.get(from)?.role === "pawn";
    const rank = squareRank(parseSquare(dest)!);
    if (isPawn && (rank === 0 || rank === 7)) {
      if (meta?.premove) onMove(orig + dest + "q"); // premoved promotions auto-queen
      else promo = { orig, dest };
    } else onMove(orig + dest);
  }

  function pick(role: "q" | "r" | "b" | "n") {
    if (promo) onMove(promo.orig + promo.dest + role);
    promo = null;
  }
  function cancel() { promo = null; onCancel(); }
</script>

<div class="wrap">
  <div bind:this={el} class="board"></div>
  {#if promo}<PromotionDialog onPick={pick} onCancel={cancel} />{/if}
</div>

<style>
  .wrap { position: relative; width: 100%; }
  .board { width: 100%; aspect-ratio: 1; touch-action: none; }
</style>