<script lang="ts">
  import type { NavAction } from "../game/history";
  import { stripItems } from "../game/moveStrip";

  let { sanByPly, ply, viewPly, onSelect, onNav }: {
    sanByPly: Record<number, string>; ply: number; viewPly: number | null;
    onSelect: (ply: number) => void; onNav: (action: NavAction) => void;
  } = $props();

  let scroller: HTMLDivElement;
  const items = $derived(stripItems(sanByPly, ply));
  const at = $derived(viewPly ?? ply);

  // Keep the shown move centred: the latest while live, the selected one while browsing.
  $effect(() => {
    void items.length; void at;
    const el = scroller?.querySelector<HTMLElement>(".san.active");
    if (el) scroller.scrollLeft = el.offsetLeft - (scroller.clientWidth - el.offsetWidth) / 2;
  });
</script>

<div class="move-strip">
  <button class="compact nav" aria-label="First move" disabled={at === 0} onclick={() => onNav("first")}>«</button>
  <button class="compact nav" aria-label="Previous move" disabled={at === 0} onclick={() => onNav("prev")}>‹</button>
  <div class="moves" bind:this={scroller}>
    {#each items as item (item.ply)}
      <button type="button" class="compact san" class:active={item.ply === at} onclick={() => onSelect(item.ply)}>{item.label}</button>
    {/each}
  </div>
  <button class="compact nav" aria-label="Next move" disabled={viewPly === null} onclick={() => onNav("next")}>›</button>
  <button class="compact nav" aria-label="Latest position" disabled={viewPly === null} onclick={() => onNav("last")}>»</button>
</div>

<style>
  .move-strip { display: flex; align-items: stretch; height: var(--move-h, 44px); background: var(--panel-hi); }
  .nav { flex: 0 0 40px; padding: 0; border-radius: 0; background: transparent; font-size: 1.2rem; }
  .moves { position: relative; flex: 1; min-width: 0; display: flex; align-items: center; gap: 0.15rem;
           overflow-x: auto; white-space: nowrap; scrollbar-width: none; }
  .moves::-webkit-scrollbar { display: none; }
  .san { flex: 0 0 auto; padding: 0.3rem 0.5rem; border-radius: 0.25rem; background: none; color: var(--text); font-size: 0.9rem; }
  .san.active { background: var(--border); color: var(--text-hi); }
</style>