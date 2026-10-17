<script lang="ts">
  import type { Snippet } from "svelte";
  import MiniBoard from "./MiniBoard.svelte";

  let { fen, lastMove = null, children }: {
    fen: string;
    lastMove?: string | null;
    children: Snippet;
  } = $props();

  let host: HTMLDivElement;
  let position = $state<{ top: number; left: number } | null>(null);

  function showPreview() {
    const link = host.querySelector("a");
    if (!link) return;
    const rect = link.getBoundingClientRect();
    const size = 180;
    const margin = 8;
    const right = rect.right + margin;
    const left = right + size <= window.innerWidth - margin
      ? right
      : Math.max(margin, rect.left - size - margin);
    const top = Math.max(margin, Math.min(rect.top, window.innerHeight - size - margin));
    position = { top, left };
  }
</script>

<div class="host" role="group" aria-label="Game link preview" bind:this={host} onmouseenter={showPreview} onmouseleave={() => (position = null)} onfocusin={showPreview} onfocusout={() => (position = null)}>
  {@render children()}
  {#if position}
    <div class="preview" style:top="{position.top}px" style:left="{position.left}px" aria-hidden="true">
      <MiniBoard {fen} {lastMove} />
    </div>
  {/if}
</div>

<style>
  .host { display: block; }
  .preview {
    position: fixed; z-index: 1000; width: 180px; padding: 0.4rem;
    background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45); pointer-events: none;
  }
</style>