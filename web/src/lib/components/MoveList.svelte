<script lang="ts">
  type Props = {
    sanByPly: Record<number, string>;
    ply: number;
    selected?: number | null;
    onSelect?: (p: number) => void;
  };

  let { sanByPly, ply, selected = null, onSelect = () => {} }: Props = $props();

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

  // Keep the latest move in view (vertical on desktop, horizontal on mobile).
  $effect(() => {
    void ply;
    if (!box) return;
    box.scrollTop = box.scrollHeight;
    box.scrollLeft = box.scrollWidth;
  });
</script>

<div class="moves" bind:this={box}>
  {#each rows as r (r.n)}
    <span class="num">{r.n}.</span>
    {#if r.white}
      <button
        type="button"
        class="san"
        class:active={selected === r.whitePly || (selected === null && r.whitePly === ply)}
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
        class="san"
        class:active={selected === r.blackPly || (selected === null && r.blackPly === ply)}
        onclick={() => onSelect(r.blackPly)}
      >
        {r.black}
      </button>
    {:else}
      <span class="san"></span>
    {/if}
  {/each}
</div>

<style>
  .moves {
    display: grid;
    grid-template-columns: 2.5rem 1fr 1fr;
    align-content: start;
    max-height: 320px;
    min-height: 120px;
    overflow-y: auto;
    margin-bottom: 1rem;
  }
  .num {
    color: var(--muted);
    padding: 0.15rem 0.25rem;
  }
  .san {
    padding: 0.15rem 0.4rem;
    border-radius: var(--radius);
    background: transparent;
    border: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .san:hover {
    background: var(--panel-hi);
  }
  .active {
    background: var(--panel-hi);
    color: var(--text-hi);
    font-weight: bold;
  }

  @media (max-width: 800px) {
    .moves {
      display: none;
    }
  }
</style>