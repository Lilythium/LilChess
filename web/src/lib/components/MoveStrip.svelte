<script lang="ts">
  import type { NavAction } from "../game/history";
  import { stripItems } from "../game/moveStrip";
  import { viewport } from "../viewport.svelte";
  import MoveList from "./MoveList.svelte";
  import MoveNav from "./MoveNav.svelte";
  import MoveSheet from "./MoveSheet.svelte";

  let { sanByPly, ply, viewPly, onSelect, onNav }: {
    sanByPly: Record<number, string>; ply: number; viewPly: number | null;
    onSelect: (ply: number) => void; onNav: (action: NavAction) => void;
  } = $props();

  let scroller = $state<HTMLDivElement>();
  let sheetOpen = $state(false);
  const items = $derived(stripItems(sanByPly, ply));
  const at = $derived(viewPly ?? ply);

  // Keep the shown move centred: the latest while live, the selected one while browsing.
  $effect(() => {
    void items.length; void at;
    const el = scroller?.querySelector<HTMLElement>(".san.active");
    if (el && scroller) scroller.scrollLeft = el.offsetLeft - (scroller.clientWidth - el.offsetWidth) / 2;
  });

  // Rotating to landscape swaps the strip for an inline list; don't leave a sheet open behind it.
  $effect(() => { if (viewport.shortLandscape) sheetOpen = false; });
</script>

{#if viewport.shortLandscape}
  <!-- Phone on its side: the column beside the board has room for the whole list. -->
  <div class="move-panel">
    <MoveNav {viewPly} total={ply} {onNav} />
    <MoveList {sanByPly} {ply} selected={viewPly} {onSelect} fill />
  </div>
{:else}
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
    <button class="compact nav all" aria-label="All moves" aria-haspopup="dialog" aria-expanded={sheetOpen}
            disabled={ply === 0} onclick={() => (sheetOpen = true)}>☰</button>
  </div>
  {#if sheetOpen}
    <MoveSheet {sanByPly} {ply} {viewPly} {onSelect} {onNav} onClose={() => (sheetOpen = false)} />
  {/if}
{/if}

<style>
  .move-strip { display: flex; align-items: stretch; height: var(--move-h, 44px); background: var(--panel-hi); }
  .nav { flex: 0 0 38px; padding: 0; border-radius: 0; background: transparent; font-size: 1.2rem; }
  .all { border-left: 1px solid var(--border); font-size: 1.05rem; }
  .moves { position: relative; flex: 1; min-width: 0; display: flex; align-items: center; gap: 0.15rem;
           overflow-x: auto; white-space: nowrap; scrollbar-width: none; }
  .moves::-webkit-scrollbar { display: none; }
  .san { flex: 0 0 auto; padding: 0.3rem 0.5rem; border-radius: 0.25rem; background: none; color: var(--text); font-size: 0.9rem; }
  .san.active { background: var(--border); color: var(--text-hi); }

  /* Landscape: nav row on top, the list fills the rest of the column. */
  .move-panel { display: flex; flex-direction: column; flex: 1 1 0; min-height: 0; background: var(--panel-hi); }
  .move-panel :global(.nav) { flex: 0 0 auto; border-bottom: 1px solid var(--border); }
  .move-panel :global(.nav button) { min-height: 36px; padding: 0; }
</style>
