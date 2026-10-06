<script lang="ts">
  import { onMount } from "svelte";
  import { Email, NOTIFICATION_KINDS, NOTIFICATION_LABELS, type NotificationKind } from "@lilchess/shared";
  import { api } from "../lib/api";
  import { auth } from "../lib/auth.svelte";
  import { validate } from "../lib/validate";

  interface Settings {
    emailAvailable: boolean;
    email: string | null;
    prefs: Record<NotificationKind, boolean>;
  }

  let data = $state<Settings | null>(null);
  let email = $state("");
  let error = $state<string | null>(null);
  let notice = $state<string | null>(null);
  let busy = $state(false);

  onMount(async () => {
    try {
      data = await api<Settings>("/api/me/notifications");
      email = data.email ?? "";
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  });

  async function save(body: { email?: string; prefs?: Partial<Record<NotificationKind, boolean>> }) {
    busy = true;
    error = null;
    notice = null;
    try {
      data = await api<Settings>("/api/me/notifications", { method: "PUT", body });
      email = data.email ?? "";
      notice = "Saved.";
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  function saveEmail(e: SubmitEvent) {
    e.preventDefault();
    const value = email.trim();
    if (value !== "") {
      const v = validate(Email, value);
      if (!v.ok) { error = v.error; notice = null; return; }
    }
    void save({ email: value });
  }

  const toggle = (kind: NotificationKind, enabled: boolean) => save({ prefs: { [kind]: enabled } });
</script>

<div class="stack">
  <div class="panel">
    <h1>Settings</h1>
    {#if auth.user?.is_guest}
      <p class="muted">Guest accounts can't receive email. Register an account to set one up.</p>
    {:else if error && !data}
      <p class="error">{error}</p>
    {:else if !data}
      <p class="muted">Loading…</p>
    {:else}
      <h2>Email</h2>
      <p class="muted">
        Optional. Used for password resets and the notifications below. It isn't verified, so
        double-check the spelling.
      </p>
      {#if !data.emailAvailable}
        <p class="muted">This server hasn't been set up to send email yet, so nothing will arrive for now.</p>
      {/if}
      <form onsubmit={saveEmail}>
        <input type="email" placeholder="you@example.com" autocomplete="email" bind:value={email} />
        <button class="primary" disabled={busy}>Save</button>
        {#if data.email}
          <button type="button" disabled={busy} onclick={() => save({ email: "" })}>Remove</button>
        {/if}
      </form>
      {#if error}<p class="error">{error}</p>{/if}
      {#if notice}<p class="muted">{notice}</p>{/if}
    {/if}
  </div>

  {#if data && !auth.user?.is_guest}
    <div class="panel">
      <h2>Email me when…</h2>
      {#if !data.email}<p class="muted">Add an email address above to use these.</p>{/if}
      <div class="options">
        {#each NOTIFICATION_KINDS as kind (kind)}
          <label class="opt">
            <input
              type="checkbox"
              checked={data.prefs[kind]}
              disabled={busy || !data.email}
              onchange={(e) => toggle(kind, e.currentTarget.checked)}
            />
            {NOTIFICATION_LABELS[kind]}
          </label>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .stack { display: flex; flex-direction: column; gap: 1rem; max-width: 560px; margin: 0 auto; }
  form { display: flex; gap: 0.5rem; flex-wrap: wrap; }
  form input { flex: 1 1 220px; }
  .options { display: flex; flex-direction: column; gap: 0.6rem; }
  .opt { display: flex; align-items: center; gap: 0.5rem; cursor: pointer; }
</style>