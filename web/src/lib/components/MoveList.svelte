<script lang="ts">
  type Props = {
    sanByPly: Record<number, string>;
    ply: number;
    selected?: number | null;
    onSelect?: (p: number) => void;
  };

  let {
    sanByPly,
    ply,
    selected = null,
    onSelect = () => {},
  }: Props = $props();

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
    void ply;

    if (!box) return;

    box.scrollTop = box.scrollHeight;
  });
</script>

<div class="moves" bind:this={box}>
  {#each rows as r (r.n)}
    <div class="move-row">
      <span class="num">{r.n}.</span>

      {#if r.white}
        <button
          type="button"
          class="san compact"
          class:active={
            selected === r.whitePly ||
            (selected === null && r.whitePly === ply)
          }
          onclick={() => onSelect(r.whitePly)}
        >
          {r.white}
        </button>
      {:else}
        <span class="san"></span>
      {/if}

      {#if r.black}
        <button
          type="button"
          class="san compact"
          class:active={
            selected === r.blackPly ||
            (selected === null && r.blackPly === ply)
          }
          onclick={() => onSelect(r.blackPly)}
        >
          {r.black}
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
  
</style>