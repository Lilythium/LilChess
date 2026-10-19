<script lang="ts">
  import { connectedServer } from "../platform";
  import { askConfirm } from "../confirm";

  const server = connectedServer();

  async function change() {
    if (!server) return;
    const ok = await askConfirm(
      "Switch to another server? You stay signed in on this one, and signing in on the next is separate.",
      { confirmLabel: "Switch server" },
    );
    if (ok) server.switchServer();
  }
</script>

{#if server}
  <div class="panel">
    <h2>Server</h2>
    <p class="addr">{server.url}</p>
    <p class="muted">LilChess server version {server.version}. Accounts and games belong to the server, not to this device.</p>
    <button type="button" onclick={change}>Switch server</button>
  </div>
{/if}

<style>
  .addr { overflow-wrap: anywhere; font-weight: 600; }
</style>
