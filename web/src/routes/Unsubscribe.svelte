<script lang="ts">
  import { api } from "../lib/api";

  let { token }: { token: string } = $props();

  let done = $state(false);
  let error = $state<string | null>(null);
  let busy = $state(false);

  async function go() {
    busy = true;
    error = null;
    try {
      await api("/api/unsubscribe", { body: { token } });
      done = true;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }
</script>

<div class="panel card">
  <h1>Turn off LilChess emails</h1>
  {#if done}
    <p>Done. You won't get any more notification emails. You can switch them back on in Settings.</p>
  {:else}
    <p>This stops every notification email for this account.</p>
    {#if error}<p class="error">{error}</p>{/if}
    <button class="primary" disabled={busy} onclick={go}>Turn off all emails</button>
  {/if}
  <p><a href="#/">Go to LilChess</a></p>
</div>

<style>
  .card { max-width: 420px; margin: 3rem auto; }
</style>