<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import { Chessground } from "chessground";
  import type { Api } from "chessground/api";
  import type { Key, MoveMetadata } from "chessground/types";
  import { chessgroundDests } from "chessops/compat";
  import { makeFen } from "chessops/fen";
  import type { Role } from "chessops/types";
  import { opposite, parseSquare, parseUci, squareRank } from "chessops/util";
  import type { Color, GameState } from "@lilchess/shared";
  import { boardMode } from "../game/boardMode";
  import { createBoardPositions } from "../game/boardPositions";
  import { gameAtPly } from "../game/history";
  import { dropSquares, dropUci, hasStrips, promotionRoles, type PromotionRole } from "../game/variantUi";
  import PromotionDialog from "./PromotionDialog.svelte";
  import VariantStrip from "./VariantStrip.svelte";


  let { game, myColor, orientation, resetKey, onMove, onCancel, viewPly = null }:
    { game: GameState; myColor: Color | null; orientation?: Color; resetKey: number;
      onMove: (uci: string) => void; onCancel: () => void;
      viewPly?: number | null } = $props(); // null = show the live position

  let el: HTMLDivElement;
  let cg: Api | undefined;
  let promo = $state<{ orig: Key; dest: Key } | null>(null);

  // ---- variants: Crazyhouse pockets / Three-check counters sit in strips above and below the board ----
  const shown = $derived(gameAtPly(game, viewPly));
  // One timeline of the game, extended a move at a time, instead of replaying it from move 1 on every change.
  const positions = createBoardPositions();
  const shownPosition = $derived(positions.at(game, shown.moves.length));
  const boardOrientation = $derived<Color>(orientation ?? myColor ?? "white");
  const strips = $derived(hasStrips(game.variant) && shownPosition !== null);
  const mode = $derived(boardMode(game, myColor, shown === game));
  const canDrop = $derived(game.variant === "crazyhouse" && myColor !== null && mode.movesEnabled && shown.turn === myColor);
  let dropRole = $state<Role | null>(null);
  let shownFen = "";

  // chessground's runtime config accepts `dropmode` (it is part of its state) but its Config type omits it.
  function setCg(config: object) {
    cg?.set(config as Parameters<Api["set"]>[0]);
  }

  function setDropMode(role: Role | null) {
    dropRole = role;
    if (!cg) return;
    const pos = positions.at(game, game.moves.length);
    if (role && myColor && pos) {
      cg.selectSquare(null); // forget any selected piece
      setCg({
        dropmode: { active: true, piece: { role, color: myColor } },
        highlight: { custom: new Map(dropSquares(pos, role).map((sq) => [sq as Key, "move-dest"])) },
      });
    } else {
      setCg({ dropmode: { active: false }, highlight: { custom: new Map() } });
    }
  }

  function pickPocket(role: Role) {
    if (canDrop) setDropMode(dropRole === role ? null : role);
  }

  // Mark where `role` may be dropped (the same dots a selected piece shows for its moves), or clear the marks.
  function showDropSquares(role: Role | null) {
    const pos = positions.at(game, game.moves.length);
    const squares = role && pos ? dropSquares(pos, role) : [];
    setCg({ highlight: { custom: new Map(squares.map((sq) => [sq as Key, "move-dest"])) } });
  }

  function dragFromPocket(role: Role, event: MouseEvent) {
    if (!canDrop || !cg || !myColor) return;
    setDropMode(null);
    showDropSquares(role);
    // The drag ends with a drop (handleDrop clears the marks) or with the mouse released somewhere else.
    window.addEventListener("mouseup", () => showDropSquares(null), { once: true });
    cg.dragNewPiece({ role, color: myColor }, event, true);
  }

  // Chessground reports a dropped piece; only a legal drop is sent on, anything else snaps back.
  function handleDrop(role: Role, key: Key) {
    setDropMode(null);
    const pos = positions.at(game, game.moves.length);
    const uci = dropUci(role, key);
    const move = parseUci(uci);
    if (pos && move && pos.isLegal(move)) onMove(uci);
    else onCancel();
  }

  $effect(() => {
    void resetKey; // a bump forces a re-sync after a rejected/cancelled move
    const pos = shownPosition; // earlier position while browsing history
    if (!pos) return;
    const last = shown.moves.at(-1);

    const api = (cg ??= Chessground(el, {
      premovable: { showDests: true, castle: true },
      movable: { free: false, events: { after: handleAfter, afterNewPiece: handleDrop } },
    }));
    const fen = makeFen(pos.toSetup());
    if (fen !== shownFen) {
      shownFen = fen;
      untrack(() => { if (dropRole !== null) setDropMode(null); }); // a new position cancels a half-made drop
    }
    api.set({
      fen,
      orientation: boardOrientation,
      turnColor: shown.turn,
      check: pos.isCheck(),
      // A drop has only a target square ("N@f3"); a normal move has origin and target.
      lastMove: last ? (last.includes("@") ? [last.slice(2, 4) as Key] : [last.slice(0, 2) as Key, last.slice(2, 4) as Key]) : undefined,
      premovable: { enabled: mode.premovesEnabled },
      movable: {
        color: mode.movableColor,
        dests: mode.movesEnabled ? chessgroundDests(pos, { chess960: shown.variant === "chess960" }) : new Map(),
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
    const pos = positions.at(game, game.moves.length);
    if (!pos) return;
    const from = parseSquare(orig)!;
    const isPawn = pos.board.get(from)?.role === "pawn";
    const rank = squareRank(parseSquare(dest)!);
    if (isPawn && (rank === 0 || rank === 7)) {
      if (meta?.premove) onMove(orig + dest + "q"); // premoved promotions auto-queen
      else promo = { orig, dest };
    } else onMove(orig + dest);
  }

  function pick(role: PromotionRole) {
    if (promo) onMove(promo.orig + promo.dest + role);
    promo = null;
  }
  function cancel() { promo = null; onCancel(); }
  onDestroy(() => cg?.destroy());
</script>

<div class="wrap">
  {#if strips && shownPosition}
    <VariantStrip pos={shownPosition} color={opposite(boardOrientation)} variant={game.variant} />
  {/if}
  <div class="boardbox">
    <div bind:this={el} class="board"></div>
    {#if promo}<PromotionDialog roles={promotionRoles(game.variant)} onPick={pick} onCancel={cancel} />{/if}
  </div>
  {#if strips && shownPosition}
    <VariantStrip
      pos={shownPosition}
      color={boardOrientation}
      variant={game.variant}
      interactive={canDrop && myColor === boardOrientation}
      selected={dropRole}
      onPick={pickPocket}
      onDrag={dragFromPocket}
    />
  {/if}
</div>

<style>
  .wrap { position: relative; width: 100%; container-type: inline-size; }
  .boardbox { position: relative; width: 100%; }
  .board {
    width: 100%;
    aspect-ratio: 1;
    touch-action: none;
    container-type: inline-size;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    -webkit-tap-highlight-color: transparent;
    --coord-light: rgba(255, 255, 255, 0.85);
    --coord-dark: rgba(72, 72, 72, 0.85);
  }

  .board :global(coords) {
    font-size: clamp(9px, 1.9cqw, 15px);
    font-weight: 600;
  }

  /* Ranks: a full-height column down the left edge, number in each square's top-left corner. */
  .board :global(coords.ranks) {
    top: 0;
    left: 0;
    right: auto;
    width: auto;
    height: 100%;
  }
  .board :global(coords.ranks coord) {
    flex: 1 1 0;
    transform: none;  
    display: flex;
    align-items: flex-start;
    padding: 0.2em 0 0 0.35em;
  }

  /* Files: a full-width row along the bottom edge, letter in each square's bottom-right corner. */
  .board :global(coords.files) {
    bottom: 0;
    left: 0;
    right: auto;
    width: 100%;
    height: auto;
    text-align: right;
  }
  .board :global(coords.files coord) {
    flex: 1 1 0;
    transform: none;
    display: flex;
    align-items: flex-end;
    justify-content: flex-end;
    padding: 0 0.35em 0.2em 0;
    text-transform: lowercase;     /* theme forces uppercase on files */
  }

  /* Colours by square parity. coord children are always in DOM order 1..8 / a..h,
     so :nth-child(odd) = ranks 1,3,5,7 and files a,c,e,g.

     White orientation: left edge = a-file (a1 is dark), bottom edge = rank 1.
     Black orientation: left edge = h-file (h1 is light), bottom edge = rank 8. */

  /* ranks on a dark square -> light text */
  .board :global(coords.ranks:not(.black) coord:nth-child(odd)),
  .board :global(coords.ranks.black coord:nth-child(even)) { color: var(--coord-light); }
  /* ranks on a light square -> dark text */
  .board :global(coords.ranks:not(.black) coord:nth-child(even)),
  .board :global(coords.ranks.black coord:nth-child(odd)) { color: var(--coord-dark); }

  /* files on a dark square -> light text */
  .board :global(coords.files:not(.black) coord:nth-child(odd)),
  .board :global(coords.files.black coord:nth-child(even)) { color: var(--coord-light); }
  /* files on a light square -> dark text */
  .board :global(coords.files:not(.black) coord:nth-child(even)),
  .board :global(coords.files.black coord:nth-child(odd)) { color: var(--coord-dark); }
</style>