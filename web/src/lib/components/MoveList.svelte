<script lang="ts">
  type Props = {
    sanByPly: Record<number, string>;
    ply: number;
    selected?: number | null;
    onSelect?: (p: number) => void;
    marks?: Record<number, string>; // ply -> "inaccuracy" | "mistake" | "blunder" | ...
    evaluations?: Record<number, string>;
    /** Fill the parent (and use touch-sized rows) instead of the fixed sidebar height. */
    fill?: boolean;
  };

  let {
    sanByPly,
    ply,
    selected = null,
    onSelect = () => {},
    marks = {},
    evaluations = {},
    fill = false,
  }: Props = $props();

  const GLYPH: Record<string, string> = { inaccuracy: "?!", mistake: "?", blunder: "??" };

  let box: HTMLDivElement;

  const rows = $derived(
    Array.from({ length: Math.ceil(ply / 2) }, (_, i) => ({
      n: i + 1,
      whitePly: i * 2 + 1,
      blackPly: i * 2 + 2,
      white: sanByPly[i * 2 + 1] ?? "",
      black: sanByPly[i * 2 + 2] ?? "",
    })),
  );

  $effect(() => {
    const activePly = selected ?? ply;

    if (!box) return;

    const move = box.querySelector<HTMLButtonElement>(
      `button[data-ply="${activePly}"]`,
    );
    const row = move?.parentElement;
    if (!row) return;

    const boxBounds = box.getBoundingClientRect();
    const rowBounds = row.getBoundingClientRect();

    if (rowBounds.top < boxBounds.top) {
      box.scrollTop += rowBounds.top - boxBounds.top;
    } else if (rowBounds.bottom > boxBounds.bottom) {
      box.scrollTop += rowBounds.bottom - boxBounds.bottom;
    }
  });

</script>

{#snippet mark(p: number)}
  {#if GLYPH[marks[p] ?? ""]}<span class="glyph {marks[p]}">{GLYPH[marks[p] ?? ""]}</span>{/if}
{/snippet}

<div class="moves" class:fill bind:this={box}>
  {#each rows as r (r.n)}
    <div class="move-row">
      <span class="num">{r.n}.</span>

      {#if r.white}
        <button
          type="button"
          class="san compact"
          data-ply={r.whitePly}
          class:active={
            selected === r.whitePly ||
            (selected === null && r.whitePly === ply)
          }
          onclick={() => onSelect(r.whitePly)}
        >
          {r.white}{@render mark(r.whitePly)}
          {#if evaluations[r.whitePly]}<span class="evaluation">{evaluations[r.whitePly]}</span>{/if}
        </button>
      {:else}
        <span class="san"></span>
      {/if}

      {#if r.black}
        <button
          type="button"
          class="san compact"
          data-ply={r.blackPly}
          class:active={
            selected === r.blackPly ||
            (selected === null && r.blackPly === ply)
          }
          onclick={() => onSelect(r.blackPly)}
        >
          {r.black}{@render mark(r.blackPly)}
          {#if evaluations[r.blackPly]}<span class="evaluation">{evaluations[r.blackPly]}</span>{/if}
        </button>
      {:else}
        <span class="san"></span>
      {/if}
    </div>
  {/each}
</div>

<style>
  .moves {
    height: clamp(140px, calc(var(--board, 600px) * 0.28), 240px);
    overflow-y: auto;
    font-size: 0.85rem;
  }

  /* Bottom sheet: take the room the sheet gives us, with rows big enough for a finger. */
  .moves.fill { flex: 1; height: auto; min-height: 0; font-size: 1rem; overscroll-behavior: contain; }
  .moves.fill .move-row { min-height: var(--tap, 44px); grid-template-columns: 2.5rem 1fr 1fr; }
  .moves.fill .san { align-self: stretch; padding: 0.15rem 0.5rem; }

  .move-row {
    display: grid;
    grid-template-columns: 2rem 1fr 1fr;
    align-items: center;
    min-height: 1.5rem;
  }

  .num {
    padding: 0.15rem 0.25rem;
    color: var(--muted);
  }

  .san {
    display: flex;
    align-items: center;
    min-width: 0;
    padding: 0.15rem 0.25rem;
    border: 0;
    border-radius: 0.2rem;
    background: none;
    color: var(--text);
    text-align: left;
    cursor: pointer;
    font: inherit;
  }

  .san:hover,
  .san.active {
    background: var(--border);
  }

  .glyph { margin-left: 0.15rem; font-weight: 700; }
  .glyph.inaccuracy { color: #56b4e9; }
  .glyph.mistake { color: #e69f00; }
  .glyph.blunder { color: #db3031; }
  .evaluation { margin-left: auto; padding-left: 0.2rem; color: var(--muted); font-size: 0.75rem; font-variant-numeric: tabular-nums; }
  
</style>