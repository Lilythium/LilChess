<script lang="ts">
  let { sanByPly, ply }: { sanByPly: Record<number, string>; ply: number } = $props();

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
    <span class="san" class:last={r.whitePly === ply}>{r.white}</span>
    <span class="san" class:last={r.blackPly === ply}>{r.black}</span>
  {/each}
</div>

<style>
  .moves { display: grid; grid-template-columns: 2.5rem 1fr 1fr; align-content: start;
           max-height: 320px; min-height: 120px; overflow-y: auto; margin-bottom: 1rem; }
  .num { color: var(--muted); padding: 0.15rem 0.25rem; }
  .san { padding: 0.15rem 0.4rem; border-radius: var(--radius); }
  .last { background: var(--panel-hi); color: var(--text-hi); }

  @media (max-width: 800px) {
    .moves { display: flex; gap: 0.25rem; min-height: 0; max-height: none;
             overflow-x: auto; overflow-y: hidden; white-space: nowrap; }
  }
</style>