<script lang="ts">
  import { exportPgn } from "../pgnExport";
  import { isNativeApp } from "../platform";

  let { id, label }: { id: string; label?: string } = $props();

  let busy = $state(false);
  let error = $state<string | null>(null);

  // The browser saves a file; the app opens the share sheet, so the wording differs.
  const text = $derived(label ?? (isNativeApp() ? "Share PGN" : "Download PGN"));

  async function run() {
    if (busy) return;
    busy = true;
    error = null;
    try {
      await exportPgn(id);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }
</script>

<button type="button" class="pgn" onclick={run} disabled={busy}>{busy ? "Preparing…" : text}</button>
{#if error}<span class="error" role="alert">{error}</span>{/if}

<style>
  .pgn {
    min-height: 44px; padding: 0.75rem 0; border: 0; background: none; color: var(--blue);
    font: inherit; cursor: pointer;
  }
  .pgn:disabled { cursor: wait; opacity: 0.6; }
  .error { font-size: 0.875rem; }
</style>
