<script lang="ts">
  import type { NavAction } from "../game/history";
  import BottomSheet from "./BottomSheet.svelte";
  import MoveList from "./MoveList.svelte";
  import MoveNav from "./MoveNav.svelte";

  // The full move list for phones. Opened from the move strip, so the board never has to give up space for it.
  let { sanByPly, ply, viewPly, onSelect, onNav, onClose }: {
    sanByPly: Record<number, string>; ply: number; viewPly: number | null;
    onSelect: (ply: number) => void; onNav: (action: NavAction) => void; onClose: () => void;
  } = $props();
</script>

<BottomSheet title="Moves" {onClose}>
  <div class="nav"><MoveNav {viewPly} total={ply} {onNav} /></div>
  {#if ply === 0}
    <p class="muted empty">No moves yet.</p>
  {:else}
    <MoveList {sanByPly} {ply} selected={viewPly} {onSelect} fill />
  {/if}
</BottomSheet>

<style>
  .nav { flex: 0 0 auto; background: var(--panel-hi); border-block: 1px solid var(--border); }
  .nav :global(button) { min-height: var(--tap); }
  .empty { padding: 1rem; margin: 0; }
</style>
