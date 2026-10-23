<script lang="ts">
  import { api } from "../api";
  import { auth, logout } from "../auth.svelte";
  import { connectedServer } from "../platform";

  // Permanent, so it takes two deliberate steps: open the form, then confirm (with the password for a registered
  // account; a guest has none, so the signed-in session is the confirmation). What the server keeps and removes is
  // documented in server/src/auth/deletion.ts.
  const isGuest = $derived(auth.user?.is_guest === 1);
  // In the browser the server is the one that served this page. In the app it can be older than the app, and then
  // the app says so instead of offering a request that would fail (docs/mobile-compatibility.md).
  const unavailable = connectedServer()?.unavailable?.accountDeletion ?? null;

  let open = $state(false);
  let password = $state("");
  let busy = $state(false);
  let error = $state<string | null>(null);

  function cancel() {
    open = false;
    password = "";
    error = null;
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = null;
    try {
      await api("/api/me/delete", { method: "POST", body: isGuest ? {} : { password } });
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      busy = false;
      return;
    }
    password = "";
    try {
      await logout(); // the server already ended the session; this clears the signed-in state and leaves the page
    } catch {
      // nothing left to clean up on the server
    }
    busy = false;
  }
</script>

<div class="panel">
  <h2>Delete account</h2>
  {#if unavailable}
    <p class="muted">{unavailable}</p>
  {:else if !open}
    <p class="muted">
      Permanently delete this {isGuest ? "guest " : ""}account. You can't get it back.
    </p>
    <button type="button" class="danger" onclick={() => (open = true)}>Delete my account…</button>
  {:else}
    <form onsubmit={submit} aria-labelledby="delete-title">
      <p id="delete-title"><strong>This can't be undone.</strong> If you continue:</p>
      <ul class="muted">
        <li>You are signed out everywhere and can never sign in to this account again.</li>
        <li>Your games stay, so your opponents keep their history, but your name is removed and shown as "Deleted user".</li>
        <li>Your rating and rating history, imported games, email address, Discord ID and notification settings are deleted.</li>
        <li>Your username becomes available for anyone to register.</li>
      </ul>
      <p class="muted">
        You can't delete an account while you have games in progress, or a tournament or simul running. Finish or resign first.
      </p>
      {#if !isGuest}
        <label for="delete-password">Enter your password to confirm</label>
        <input
          id="delete-password"
          type="password"
          autocomplete="current-password"
          bind:value={password}
          disabled={busy}
          required
        />
      {/if}
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <div class="row">
        <button type="submit" class="danger" disabled={busy || (!isGuest && !password)}>
          {busy ? "Deleting…" : "Permanently delete my account"}
        </button>
        <button type="button" disabled={busy} onclick={cancel}>Cancel</button>
      </div>
    </form>
  {/if}
</div>

<style>
  form { display: flex; flex-direction: column; gap: 0.6rem; }
  ul { margin: 0; padding-left: 1.25rem; display: flex; flex-direction: column; gap: 0.3rem; }
  label { font-weight: 600; margin-top: 0.4rem; }
  .row { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.4rem; }
  button.danger { color: var(--red); border-color: var(--red); }
</style>
