<script lang="ts">
  import { ForgotPasswordBody } from "@lilchess/shared";
  import { api } from "../lib/api";
  import { validate } from "../lib/validate";

  let identifier = $state("");
  let error = $state<string | null>(null);
  let sent = $state(false);
  let busy = $state(false);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = null;
    const v = validate(ForgotPasswordBody, { identifier });
    if (!v.ok) { error = v.error; return; }
    busy = true;
    try {
      await api("/api/password/forgot", { body: v.data });
      sent = true;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }
</script>

<div class="panel card">
  <h1>Reset your password</h1>
  {#if sent}
    <p>If that account has an email address on file, a reset link is on its way. It's valid for one hour.</p>
  {:else}
    <form onsubmit={submit}>
      <input placeholder="Username or email" autocomplete="username" bind:value={identifier} required />
      {#if error}<span class="error">{error}</span>{/if}
      <button class="primary" disabled={busy}>Send reset link</button>
    </form>
    <p class="muted">This only works if you added an email address in Settings.</p>
  {/if}
  <a href="#/login">Back to log in</a>
</div>

<style>
  .card { max-width: 340px; margin: clamp(1rem, 8vh, 4rem) auto; }
  form { display: flex; flex-direction: column; gap: 0.75rem; }
</style>