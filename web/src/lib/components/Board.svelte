<script lang="ts">
  import { Chessground } from "chessground";
  import type { Api } from "chessground/api";
  import type { Key } from "chessground/types";
  import { chessgroundDests } from "chessops/compat";
  import { makeFen } from "chessops/fen";
  import { parseSquare, squareRank } from "chessops/util";
  import { replay, type Color, type GameState } from "@lilchess/shared";
  import PromotionDialog from "./PromotionDialog.svelte";

  let { game, myColor, orientation, resetKey, onMove, onCancel }:
    { game: GameState; myColor: Color | null; orientation?: Color; resetKey: number;
      onMove: (uci: string) => void; onCancel: () => void } = $props();

  let el: HTMLDivElement;
  let cg: Api | undefined;
  let promo = $state<{ orig: Key; dest: Key } | null>(null);

  $effect(() => {
    void resetKey; // a bump forces a re-sync after a rejected/cancelled move
    const r = replay(game);
    if (!r.ok) return;
    const pos = r.position;
    const last = game.moves.at(-1);
    const myTurn = game.status === "started" && myColor === game.turn;

    cg ??= Chessground(el, {
      premovable: { enabled: false },
      movable: { free: false, events: { after: handleAfter } },
    });
    cg.set({
      fen: makeFen(pos.toSetup()),
      orientation: orientation ?? myColor ?? "white",
      turnColor: game.turn,
      check: pos.isCheck(),
      lastMove: last ? [last.slice(0, 2) as Key, last.slice(2, 4) as Key] : undefined,
      movable: { color: myTurn ? myColor! : undefined, dests: myTurn ? chessgroundDests(pos) : new Map() },
    });
  });

  function handleAfter(orig: Key, dest: Key) {
    const r = replay(game);
    if (!r.ok) return;
    const from = parseSquare(orig)!;
    const isPawn = r.position.board.get(from)?.role === "pawn";
    const rank = squareRank(parseSquare(dest)!);
    if (isPawn && (rank === 0 || rank === 7)) promo = { orig, dest };
    else onMove(orig + dest);
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