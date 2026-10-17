<script lang="ts">
  import type { Snippet } from "svelte";
  import { onDestroy, untrack } from "svelte";
  import { Chessground } from "chessground";
  import type { Api } from "chessground/api";
  import type { Key } from "chessground/types";
  import type { Position } from "chessops/chess";
  import { chessgroundDests } from "chessops/compat";
  import type { Role } from "chessops/types";
  import { opposite, parseSquare, parseUci, squareRank } from "chessops/util";
  import { positionFromFen, type Color, type Variant } from "@lilchess/shared";
  import { dropSquares, dropUci, hasStrips, promotionRoles, type PromotionRole } from "../game/variantUi";
  import PromotionDialog from "./PromotionDialog.svelte";
  import VariantStrip from "./VariantStrip.svelte";

  let { fen, orientation, lastMove = null, arrow = null, chess960 = false, variant = "standard", interactive = true,
    stripPlacement = "stacked", railContent, onMove }: {
    fen: string;
    orientation: Color;
    /** Every variant is playable here, including Crazyhouse drops (pocket pieces) and Antichess king promotion. */
    variant?: Variant;
    /** False makes the board view-only. */
    interactive?: boolean;
    lastMove?: [string, string] | null;
    arrow?: [string, string] | null; // the engine's suggestion
    chess960?: boolean;
    stripPlacement?: "stacked" | "rail";
    railContent?: Snippet;
    onMove: (uci: string) => void;
  } = $props();

  let el = $state<HTMLDivElement>();
  let cg: Api | undefined;
  let position = $state.raw<Position | null>(null); // current position: promotion, drops and the strips read it
  let promo = $state<{ orig: Key; dest: Key } | null>(null);
  let dropRole = $state<Role | null>(null);
  let shownFen = "";

  const strips = $derived(hasStrips(variant) && position !== null);

  // chessground's runtime config accepts `dropmode` (it is part of its state) but its Config type omits it.
  function setCg(config: object) {
    cg?.set(config as Parameters<Api["set"]>[0]);
  }

  function setDropMode(role: Role | null) {
    dropRole = role;
    if (!cg) return;
    if (role && position) {
      cg.selectSquare(null);
      setCg({
        dropmode: { active: true, piece: { role, color: position.turn } },
        highlight: { custom: new Map(dropSquares(position, role).map((sq) => [sq as Key, "move-dest"])) },
      });
    } else {
      setCg({ dropmode: { active: false }, highlight: { custom: new Map() } });
    }
  }

  function pickPocket(role: Role) {
    if (interactive) setDropMode(dropRole === role ? null : role);
  }

  // Mark where `role` may be dropped (the same dots a selected piece shows for its moves), or clear the marks.
  function showDropSquares(role: Role | null) {
    const squares = role && position ? dropSquares(position, role) : [];
    setCg({ highlight: { custom: new Map(squares.map((sq) => [sq as Key, "move-dest"])) } });
  }

  function dragFromPocket(role: Role, event: MouseEvent) {
    if (!interactive || !cg || !position) return;
    setDropMode(null);
    showDropSquares(role);
    // The drag ends with a drop (handleDrop clears the marks) or with the mouse released somewhere else.
    window.addEventListener("mouseup", () => showDropSquares(null), { once: true });
    cg.dragNewPiece({ role, color: position.turn }, event, true);
  }

  // Chessground reports a dropped piece; only a legal drop is sent on, anything else snaps back.
  function handleDrop(role: Role, key: Key) {
    setDropMode(null);
    const uci = dropUci(role, key);
    const move = parseUci(uci);
    if (position && move && position.isLegal(move)) onMove(uci);
    else cg?.set({ fen });
  }

  $effect(() => {
    let pos: Position;
    try {
      pos = positionFromFen(fen, variant);
    } catch {
      return;
    }
    position = pos;
    if (!el) return;

    const api = (cg ??= Chessground(el, {
      premovable: { enabled: false },
      movable: { free: false, events: { after: handleAfter, afterNewPiece: handleDrop } },
      drawable: { enabled: true },
    }));
    if (fen !== shownFen) {
      shownFen = fen;
      untrack(() => { if (dropRole !== null) setDropMode(null); }); // a new position cancels a half-made drop
    }
    api.set({
      fen,
      orientation,
      turnColor: pos.turn,
      check: pos.isCheck(),
      // A drop has only a target square; a normal move has origin and target.
      lastMove: lastMove ? (lastMove[0] === lastMove[1] ? [lastMove[0] as Key] : [lastMove[0] as Key, lastMove[1] as Key]) : undefined,
      movable: interactive ? { color: pos.turn, dests: chessgroundDests(pos, { chess960 }) } : { color: undefined, dests: new Map() },
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

  function pick(role: PromotionRole) {
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

<div class="wrap" class:rail-layout={stripPlacement === "rail"}>
  {#if stripPlacement === "rail"}
    <aside class="variant-tools" class:empty={!strips && variant !== "chess960"} aria-hidden={!strips && variant !== "chess960"}>
      {#if railContent}{@render railContent()}{/if}
      {#if strips && position}
        <div class="strips">
          <VariantStrip pos={position} color={opposite(orientation)} {variant} layout="vertical"
            interactive={interactive && position.turn === opposite(orientation)}
            selected={position.turn === opposite(orientation) ? dropRole : null}
            onPick={pickPocket} onDrag={dragFromPocket} />
          <VariantStrip pos={position} color={orientation} {variant} layout="vertical"
            interactive={interactive && position.turn === orientation}
            selected={position.turn === orientation ? dropRole : null}
            onPick={pickPocket} onDrag={dragFromPocket} />
        </div>
      {/if}
    </aside>
    <div class="boardbox">
      <div bind:this={el} class="board"></div>
      {#if promo}<PromotionDialog roles={promotionRoles(variant)} onPick={pick} onCancel={cancelPromo} />{/if}
    </div>
  {:else}
    {#if strips && position}
      <VariantStrip pos={position} color={opposite(orientation)} {variant}
        interactive={interactive && position.turn === opposite(orientation)}
        selected={position.turn === opposite(orientation) ? dropRole : null}
        onPick={pickPocket} onDrag={dragFromPocket} />
    {/if}
    <div class="boardbox">
      <div bind:this={el} class="board"></div>
      {#if promo}<PromotionDialog roles={promotionRoles(variant)} onPick={pick} onCancel={cancelPromo} />{/if}
    </div>
    {#if strips && position}
      <VariantStrip pos={position} color={orientation} {variant}
        interactive={interactive && position.turn === orientation}
        selected={position.turn === orientation ? dropRole : null}
        onPick={pickPocket} onDrag={dragFromPocket} />
    {/if}
  {/if}
</div>

<style>
  .wrap { position: relative; width: 100%; container-type: inline-size; }
  .wrap.rail-layout {
    display: grid; grid-template-columns: var(--variant-tools-width, 96px) minmax(0, 1fr);
    gap: var(--variant-tools-gap, 0.5rem); align-items: stretch;
  }
  .variant-tools { position: relative; display: flex; align-items: center; justify-content: center; min-width: 0; }
  .variant-tools.empty { visibility: hidden; }
  .strips { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: space-between; }
  .boardbox { position: relative; width: 100%; }
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

  @media (max-width: 900px) {
    .wrap.rail-layout { grid-template-columns: minmax(0, 1fr); grid-template-rows: 72px auto; gap: 0; }
    .variant-tools { grid-row: 1; width: 100%; }
    .strips { position: static; display: grid; grid-template-rows: 1fr 1fr; width: 100%; height: 100%; }
    .boardbox { grid-row: 2; }
  }
</style>
