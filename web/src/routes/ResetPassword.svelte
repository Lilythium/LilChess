<script lang="ts">
  import { ResetPasswordBody } from "@lilchess/shared";
  import { api } from "../lib/api";
  import { validate } from "../lib/validate";

  let { token }: { token: string } = $props();

  let password = $state("");
  let error = $state<string | null>(null);
  let done = $state(false);
  let busy = $state(false);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = null;
    const v = validate(ResetPasswordBody, { token, password });
    if (!v.ok) { error = v.error; return; }
    busy = true;
    try {
      await api("/api/password/reset", { body: v.data });
      done = true;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }
</script>

<div class="panel card">
  <h1>Choose a new password</h1>
  {#if done}
    <p>Your password has been changed and you've been logged out everywhere.</p>
    <a href="#/login">Log in</a>
  {:else}
    <form onsubmit={submit}>
      <input type="password" placeholder="New password" autocomplete="new-password" bind:value={password} required />
      <span class="muted">At least 8 characters.</span>
      {#if error}<span class="error">{error}</span>{/if}
      <button class="primary" disabled={busy}>Change password</button>
    </form>
  {/if}
</div>

<style>
  .card { max-width: 340px; margin: 4rem auto; }
  form { display: flex; flex-direction: column; gap: 0.75rem; }
</style>