<script lang="ts">
  import type { NavAction } from "../game/history";

  let {
    viewPly,
    total,
    onNav,
  }: {
    viewPly: number | null;
    total: number;
    onNav: (action: NavAction) => void;
  } = $props();

  const at = $derived(viewPly ?? total);
</script>

<div class="nav">
  <button aria-label="First move" disabled={at === 0} onclick={() => onNav("first")}>«</button>
  <button aria-label="Previous move" disabled={at === 0} onclick={() => onNav("prev")}>‹</button>
  <button aria-label="Next move" disabled={viewPly === null} onclick={() => onNav("next")}>›</button>
  <button aria-label="Latest position" disabled={viewPly === null} onclick={() => onNav("last")}>»</button>
</div>

<style>
  .nav { display: flex; }
  .nav button {
    flex: 1;
    padding: 0.4rem 0;
    background: transparent;
    border-radius: 0;
    font-size: 1.1rem;
  }
  .nav button:hover:not(:disabled) { background: #3a3835; }
</style>