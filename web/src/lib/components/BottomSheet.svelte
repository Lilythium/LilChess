<script lang="ts">
  import type { Snippet } from "svelte";

  let { title, onClose, children }: {
    title: string;
    onClose: () => void;
    children: Snippet;
  } = $props();

  let sheet: HTMLDivElement;

  // Move focus into the sheet while it is open and give it back to whatever opened it.
  $effect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    sheet?.focus({ preventScroll: true });
    return () => { if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  });
</script>

<svelte:window onkeydown={(e) => { if (e.key === "Escape") onClose(); }} />

<div class="sheet-root">
  <button class="backdrop" type="button" tabindex="-1" aria-label="Close {title}" onclick={onClose}></button>
  <div class="sheet" role="dialog" aria-modal="true" aria-label={title} tabindex="-1" bind:this={sheet}>
    <div class="grab" aria-hidden="true"></div>
    <div class="head">
      <h2>{title}</h2>
      <button class="close" type="button" aria-label="Close {title}" onclick={onClose}>✕</button>
    </div>
    <div class="body">{@render children()}</div>
  </div>
</div>

<style>
  /* No page scrolling behind an open sheet. */
  :global(html:has(.sheet-root)) { overflow: hidden; }

  .sheet-root { position: fixed; inset: 0; z-index: 200; display: flex; flex-direction: column; justify-content: flex-end; }
  .backdrop { position: absolute; inset: 0; padding: 0; border: 0; border-radius: 0; background: rgba(0, 0, 0, 0.5); }
  .sheet {
    position: relative; display: flex; flex-direction: column; min-height: 0;
    max-height: min(65dvh, 520px);
    margin: 0 auto; width: 100%; max-width: 640px;
    padding-bottom: env(safe-area-inset-bottom, 0px);
    padding-left: env(safe-area-inset-left, 0px); padding-right: env(safe-area-inset-right, 0px);
    background: var(--panel); border-top: 1px solid var(--border);
    border-radius: 14px 14px 0 0; box-shadow: 0 -6px 24px rgba(0, 0, 0, 0.5);
    outline: none; animation: rise 0.18s ease-out;
  }
  .grab { width: 36px; height: 4px; margin: 8px auto 0; border-radius: 2px; background: var(--border); }
  .head { display: flex; align-items: center; justify-content: space-between; padding: 0.25rem 0.5rem 0.25rem 1rem; }
  h2 { margin: 0; font-size: 1rem; }
  .close { width: var(--tap); height: var(--tap); padding: 0; background: transparent; font-size: 1.1rem; }
  .body { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow-y: auto; overscroll-behavior: contain; }

  @keyframes rise { from { transform: translateY(24px); opacity: 0; } to { transform: none; opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { .sheet { animation: none; } }
</style>
