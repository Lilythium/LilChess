<script lang="ts">
  import { onMount } from "svelte";
  import { DiscordId, Email, NOTIFICATION_KINDS, NOTIFICATION_LABELS, type NotificationKind } from "@lilchess/shared";
  import { api } from "../lib/api";
  import { auth } from "../lib/auth.svelte";
  import { currentSubscription, disablePush, enablePush, permission, pushSupport } from "../lib/push";
  import { validate } from "../lib/validate";
  import SoundSettings from "../lib/components/SoundSettings.svelte";
  import NativeServerPanel from "../lib/components/NativeServerPanel.svelte";
  import DeleteAccount from "../lib/components/DeleteAccount.svelte";

  interface Settings {
    emailAvailable: boolean;
    email: string | null;
    prefs: Record<NotificationKind, boolean>;
    discordAvailable: boolean;
    discordId: string | null;
    discordPrefs: Record<NotificationKind, boolean>;
    pushAvailable: boolean;
    pushPublicKey: string | null;
    pushDevices: number;
    pushPrefs: Record<NotificationKind, boolean>;
  }
  type Prefs = Partial<Record<NotificationKind, boolean>>;

  let data = $state<Settings | null>(null);
  let email = $state("");
  let discordId = $state("");
  let error = $state<string | null>(null);
  let notice = $state<string | null>(null);
  let busy = $state(false);

  const support = pushSupport();
  let thisDevice = $state(false); // does this browser hold a push subscription?
  let perm = $state<NotificationPermission>(permission());

  onMount(async () => {
    try {
      data = await api<Settings>("/api/me/notifications");
      email = data.email ?? "";
      discordId = data.discordId ?? "";
      thisDevice = (await currentSubscription().catch(() => null)) !== null;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  });

  async function save(body: { email?: string; prefs?: Prefs; discordId?: string; discordPrefs?: Prefs; pushPrefs?: Prefs }) {
    busy = true;
    error = null;
    notice = null;
    try {
      data = await api<Settings>("/api/me/notifications", { method: "PUT", body });
      email = data.email ?? "";
      discordId = data.discordId ?? "";
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
  const toggleDiscord = (kind: NotificationKind, enabled: boolean) => save({ discordPrefs: { [kind]: enabled } });
  const togglePush = (kind: NotificationKind, enabled: boolean) => save({ pushPrefs: { [kind]: enabled } });

  // Run a push action with the shared busy/error/notice handling, then refresh the device count.
  async function pushAction(fn: () => Promise<string | void>) {
    busy = true;
    error = null;
    notice = null;
    try {
      const done = await fn();
      data = await api<Settings>("/api/me/notifications");
      thisDevice = (await currentSubscription().catch(() => null)) !== null;
      if (done) notice = done;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      perm = permission();
      busy = false;
    }
  }

  const enableThisDevice = () =>
    pushAction(async () => {
      await enablePush(data!.pushPublicKey!);
      return "Notifications are on for this device.";
    });
  const disableThisDevice = () =>
    pushAction(async () => {
      await disablePush();
      return "Notifications are off for this device.";
    });
  const sendTest = () =>
    pushAction(async () => {
      const r = await api<{ sent: number; devices: number }>("/api/me/push-test", { method: "POST", body: {} });
      return r.sent > 0 ? "Test sent. It should arrive in a moment." : "The push service didn't accept the test. Try turning notifications off and on again.";
    });

  function saveDiscord(e: SubmitEvent) {
    e.preventDefault();
    const value = discordId.trim();
    if (value !== "") {
      const v = validate(DiscordId, value);
      if (!v.ok) { error = v.error; notice = null; return; }
    }
    void save({ discordId: value });
  }
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

  <SoundSettings />
  <NativeServerPanel />

  {#if data && !auth.user?.is_guest}
    <div class="panel">
      <h2>Browser notifications</h2>
      <p class="muted">
        Optional. Get a notification on this device when it's your turn or someone challenges you, even when
        LilChess isn't open. Each browser or phone you use has to be turned on separately.
      </p>
      {#if !data.pushAvailable}
        <p class="muted">This server has push notifications switched off.</p>
      {:else if support === "native"}
        <p class="muted">Push notifications aren't available in the mobile app yet. Use email or Discord notifications for now.</p>
      {:else if support === "needs-install"}
        <p class="muted">On iPhone and iPad, add LilChess to your Home Screen first (Share → Add to Home Screen), then open it from there.</p>
      {:else if support === "unsupported"}
        <p class="muted">This browser doesn't support push notifications.</p>
      {:else}
        {#if perm === "denied" && !thisDevice}
          <p class="muted">Notifications are blocked for this site. Allow them in your browser's site settings, then come back.</p>
        {/if}
        <div class="row">
          {#if thisDevice}
            <button type="button" disabled={busy} onclick={disableThisDevice}>Turn off for this device</button>
            <button type="button" disabled={busy} onclick={sendTest}>Send a test</button>
          {:else}
            <button class="primary" type="button" disabled={busy || perm === "denied"} onclick={enableThisDevice}>
              Turn on for this device
            </button>
          {/if}
        </div>
        {#if data.pushDevices > 0}
          <p class="muted">{data.pushDevices} {data.pushDevices === 1 ? "device" : "devices"} registered on your account.</p>
        {/if}

        <h3>Notify me when…</h3>
        {#if data.pushDevices === 0}<p class="muted">Turn on a device above to use these.</p>{/if}
        <div class="options">
          {#each NOTIFICATION_KINDS as kind (kind)}
            <label class="opt">
              <input
                type="checkbox"
                checked={data.pushPrefs[kind]}
                disabled={busy || data.pushDevices === 0}
                onchange={(e) => togglePush(kind, e.currentTarget.checked)}
              />
              {NOTIFICATION_LABELS[kind]}
            </label>
          {/each}
        </div>
      {/if}
    </div>

    <div class="panel">
      <h2>Discord</h2>
      <p class="muted">
        Optional. Give your Discord user ID and this server will @mention you in its Discord channel for the
        events below. It isn't verified, so double-check the digits. (In Discord: Settings → Advanced → turn on
        Developer Mode, then right-click your name → Copy User ID.) Discord can't be used to reset a password.
      </p>
      {#if !data.discordAvailable}
        <p class="muted">This server hasn't been connected to a Discord channel yet, so nothing will arrive for now.</p>
      {/if}
      <form onsubmit={saveDiscord}>
        <input inputmode="numeric" placeholder="123456789012345678" autocomplete="off" bind:value={discordId} />
        <button class="primary" disabled={busy}>Save</button>
        {#if data.discordId}
          <button type="button" disabled={busy} onclick={() => save({ discordId: "" })}>Remove</button>
        {/if}
      </form>

      <h3>Ping me on Discord when…</h3>
      {#if !data.discordId}<p class="muted">Add your Discord user ID above to use these.</p>{/if}
      <div class="options">
        {#each NOTIFICATION_KINDS as kind (kind)}
          <label class="opt">
            <input
              type="checkbox"
              checked={data.discordPrefs[kind]}
              disabled={busy || !data.discordId}
              onchange={(e) => toggleDiscord(kind, e.currentTarget.checked)}
            />
            {NOTIFICATION_LABELS[kind]}
          </label>
        {/each}
      </div>
    </div>
  {/if}

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

  <DeleteAccount />
</div>

<style>
  .stack { display: flex; flex-direction: column; gap: 1rem; max-width: 560px; margin: 0 auto; }
  .row { display: flex; gap: 0.5rem; flex-wrap: wrap; margin: 0.5rem 0; }
  form { display: flex; gap: 0.5rem; flex-wrap: wrap; }
  form input { flex: 1 1 220px; }
  .options { display: flex; flex-direction: column; gap: 0.6rem; }
  .opt { display: flex; align-items: center; gap: 0.5rem; padding: 0.35rem 0; cursor: pointer; }
</style>