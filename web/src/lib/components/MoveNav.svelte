<script lang="ts">
  import type { NavAction } from "../game/history";

  let { viewPly, total, onNav }: {
    viewPly: number | null;
    total: number;
    onNav: (action: NavAction) => void;
  } = $props();

  const at = $derived(viewPly ?? total);
</script>

<div class="row nav">
  <button aria-label="First move" disabled={at === 0} onclick={() => onNav("first")}>«</button>
  <button aria-label="Previous move" disabled={at === 0} onclick={() => onNav("prev")}>‹</button>
  <button aria-label="Next move" disabled={viewPly === null} onclick={() => onNav("next")}>›</button>
  <button aria-label="Latest position" disabled={viewPly === null} onclick={() => onNav("last")}>»</button>
  {#if viewPly !== null}<span class="muted">Move {viewPly} of {total}</span>{/if}
</div>

<style>
  .nav { margin-bottom: 0.5rem; }
  .nav button { padding: 0.35rem 0.8rem; }
</style>