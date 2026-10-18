<script lang="ts">
  import type { SocketStatus } from "../ws/reconnectingSocket";

  // A small pill, not a layout change: the board never moves when the connection drops or returns.
  let { status, onRetry }: { status: SocketStatus; onRetry?: () => void } = $props();

  // Brief drops (a reconnect that takes a second) are not worth announcing.
  const GRACE_MS = 1500;
  let shown = $state<SocketStatus>("open");

  $effect(() => {
    const next = status;
    if (next === "open") { shown = "open"; return; }
    // "failed" and "unauthorized" need the user to act, so they appear straight away.
    if (next === "failed" || next === "unauthorized") { shown = next; return; }
    const timer = setTimeout(() => (shown = next), GRACE_MS);
    return () => clearTimeout(timer);
  });
</script>

{#if shown !== "open"}
  <div class="banner" class:bad={shown === "failed" || shown === "unauthorized"} role="status" aria-live="polite">
    {#if shown === "unauthorized"}
      Your session has expired. Log in again to keep playing.
    {:else if shown === "failed"}
      Connection lost.
      <button type="button" class="compact" onclick={() => onRetry?.()}>Retry</button>
    {:else}
      Reconnecting…
    {/if}
  </div>
{/if}

<style>
  .banner {
    position: fixed; z-index: 80; left: 50%; transform: translateX(-50%);
    top: calc(var(--header-h) + 0.4rem); max-width: calc(100vw - 1.5rem);
    display: flex; align-items: center; gap: 0.6rem; padding: 0.4rem 0.9rem;
    background: var(--panel-hi); color: var(--text-hi); border: 1px solid var(--border);
    border-radius: 999px; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45); font-size: 0.9rem;
  }
  .banner.bad { border-color: #a9453d; }
  .banner button { min-height: 32px; padding: 0 0.8rem; }
</style>
