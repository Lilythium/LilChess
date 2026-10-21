<script lang="ts">
  import { onMount } from "svelte";
  import { startDemoGame } from "../../../mobile/src/nativeDemo.js";
  import { createNativeGuestSession, loginNative, registerNative, type NativeSession } from "../../../mobile/src/nativeAuth.js";
  import type { InviteLink } from "../../../mobile/src/inviteLink.js";
  import { fetchInvitePreview, type InvitePreview } from "../../../mobile/src/nativeInvites.js";
  import type { LilChessHealth } from "../../../mobile/src/serverSelection.js";
  import { displayName, timeControl } from "../lib/format";

  // Shown when there is no valid session for the selected server. Whatever the person picks here, the shell
  // (NativeRoot) takes the resulting session and mounts the game UI. Nothing on this screen trusts an invite link:
  // the preview and the guest permission both come from the server.
  let { serverUrl, health, invite = null, notice = null, onsession, ondemo, onchangeserver, ondropinvite }: {
    serverUrl: string;
    health: LilChessHealth;
    invite?: InviteLink | null;
    notice?: string | null;
    onsession: (session: NativeSession) => void;
    /** A demo game was started: the shell signs in as the new guest and opens the game. */
    ondemo: (session: NativeSession, gameId: string) => void;
    onchangeserver: () => void;
    ondropinvite: () => void;
  } = $props();

  const registrationMode = $derived(health.features.registration);

  let mode = $state<"login" | "register">("login");
  let username = $state("");
  let password = $state("");
  let inviteCode = $state("");
  let busy = $state(false);
  let errorMessage = $state<string | null>(null);

  let preview = $state<InvitePreview | null>(null);
  let previewError = $state<string | null>(null);
  let previewLoading = $state(false);

  onMount(() => {
    if (invite) void loadPreview(invite);
  });

  async function loadPreview(link: InviteLink): Promise<void> {
    previewLoading = true;
    try {
      preview = await fetchInvitePreview(serverUrl, link.target);
    } catch (error) {
      previewError = messageOf(error, "This invite could not be checked.");
    } finally {
      previewLoading = false;
    }
  }

  const guestAllowed = $derived(preview?.kind === "challenge" && preview.guestsAllowed);

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    errorMessage = null;
    busy = true;
    try {
      const session = mode === "login"
        ? await loginNative(serverUrl, username.trim(), password)
        : await registerNative(serverUrl, username.trim(), password, inviteCode);
      password = "";
      inviteCode = "";
      onsession(session);
    } catch (error) {
      errorMessage = messageOf(error, "Authentication failed. Check the details and try again.");
    } finally {
      busy = false;
    }
  }

  async function playAsGuest(): Promise<void> {
    if (!invite || invite.target.kind !== "challenge") return;
    errorMessage = null;
    busy = true;
    try {
      onsession(await createNativeGuestSession(serverUrl, invite.target.id));
    } catch (error) {
      errorMessage = messageOf(error, "Could not start a guest session for this invite.");
    } finally {
      busy = false;
    }
  }

  async function tryDemo(): Promise<void> {
    errorMessage = null;
    busy = true;
    try {
      const { session, gameId } = await startDemoGame(serverUrl);
      ondemo(session, gameId);
    } catch (error) {
      errorMessage = messageOf(error, "Could not start the demo game. Try again in a moment.");
    } finally {
      busy = false;
    }
  }

  function messageOf(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback;
  }

  const host = $derived(serverUrl.replace(/^https?:\/\//, ""));
</script>

<svelte:head>
  <title>Sign in to LilChess</title>
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
</svelte:head>

<main class="screen">
  <section class="panel" aria-labelledby="auth-title">
    <p class="eyebrow">LILCHESS MOBILE</p>
    <p class="server-line">
      <span class="server-host">{host}</span>
      <span class="version">v{health.version}</span>
      <button class="link" type="button" onclick={onchangeserver} disabled={busy}>Change server</button>
    </p>
    {#if serverUrl.startsWith("http://")}
      <p class="warning">This connection uses unencrypted HTTP. Use it only on a trusted local network.</p>
    {/if}

    {#if notice}
      <p class="notice" role="status">{notice}</p>
    {/if}

    {#if health.features.demo}
      <div class="demo">
        <h2>Try LilChess</h2>
        <p class="subtle">
          This is a demo server. Play a 10 minute game against a practice bot as a guest: no account needed.
        </p>
        <button type="button" onclick={tryDemo} disabled={busy}>{busy ? "Please wait…" : "Play a demo game"}</button>
        <p class="subtle guest-note">
          Demo guests can't create challenges, play rated games, join simuls or tournaments, or get notifications. Demo accounts and games
          are deleted automatically after a short time, so don't expect to keep them. Register to keep your games.
        </p>
      </div>
      <p class="or">or sign in</p>
    {/if}

    {#if invite}
      <div class="invite" aria-live="polite">
        {#if previewLoading}
          <p class="subtle">Checking your invite…</p>
        {:else if previewError}
          <p class="error" role="alert">{previewError}</p>
          <button class="secondary" type="button" onclick={ondropinvite}>Continue without the invite</button>
        {:else if preview?.kind === "challenge"}
          <h2>{displayName(preview.from_name)} invited you to play</h2>
          <p class="subtle">
            {timeControl(preview)} · {preview.mode === "live" ? "Live" : "Correspondence"}
          </p>
        {:else if preview?.kind === "simul"}
          <h2>{displayName(preview.hostName)} invited you to a simul</h2>
          <p class="subtle">{preview.name} · {preview.accepted}/{preview.maxPlayers} players</p>
          <p class="subtle">Joining a simul needs a registered account.</p>
        {/if}
      </div>

      {#if guestAllowed}
        <button type="button" onclick={playAsGuest} disabled={busy}>
          {busy ? "Please wait…" : "Play as a guest"}
        </button>
        <p class="subtle guest-note">
          Guests can play this game but not simuls, email or notifications, and a guest account can't be recovered if
          you log out or uninstall the app. Register to keep your games.
        </p>
        <p class="or">or sign in</p>
      {/if}
    {/if}

    <h1 id="auth-title">{mode === "login" ? "Sign in" : "Create an account"}</h1>
    <p class="subtle">Accounts and sessions are separate for each server.</p>
    {#if registrationMode !== "closed"}
      <div class="mode-switch" aria-label="Authentication mode">
        <button class:active={mode === "login"} type="button" onclick={() => { mode = "login"; errorMessage = null; }}>Sign in</button>
        <button class:active={mode === "register"} type="button" onclick={() => { mode = "register"; errorMessage = null; }}>Register</button>
      </div>
    {/if}
    <form onsubmit={submit}>
      <label for="native-username">Username</label>
      <input id="native-username" bind:value={username} autocomplete="username" autocapitalize="off" spellcheck="false" required disabled={busy} />
      <label for="native-password">Password</label>
      <input id="native-password" bind:value={password} type="password" autocomplete={mode === "login" ? "current-password" : "new-password"} required disabled={busy} />
      {#if mode === "register" && registrationMode === "invite"}
        <label for="native-invite-code">Registration invite code</label>
        <input id="native-invite-code" bind:value={inviteCode} autocomplete="off" disabled={busy} />
      {/if}
      <button type="submit" disabled={busy || !username.trim() || !password}>
        {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
      </button>
    </form>
    {#if registrationMode === "closed"}
      <p class="subtle">Registration is closed on this server. Existing accounts can still sign in.</p>
    {/if}

    {#if errorMessage}
      <p class="error" role="alert">{errorMessage}</p>
    {/if}
  </section>
</main>

<style>
  .screen {
    box-sizing: border-box; min-height: 100dvh; display: grid; justify-items: center; align-items: safe center;
    padding: max(1.25rem, env(safe-area-inset-top, 0px)) max(1.25rem, env(safe-area-inset-right, 0px))
             max(1.25rem, env(safe-area-inset-bottom, 0px)) max(1.25rem, env(safe-area-inset-left, 0px));
    background: #101318; color: #f2f4f7; font: 16px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  .panel {
    box-sizing: border-box; width: min(100%, 34rem); padding: clamp(1.25rem, 5vw, 2.25rem);
    border: 1px solid #333b47; border-radius: 1rem; background: #191e26; box-shadow: 0 1.25rem 3.5rem #0005;
  }
  .eyebrow { margin: 0 0 .5rem; color: #a9b5c5; font-size: .75rem; font-weight: 750; letter-spacing: .14em; }
  .server-line { display: flex; flex-wrap: wrap; align-items: center; gap: .25rem .75rem; margin: 0 0 1rem; }
  .server-host { overflow-wrap: anywhere; font-weight: 750; }
  .version { color: #aeb8c6; font-size: .875rem; }
  h1 { margin: 1rem 0 .25rem; font-size: 1.4rem; line-height: 1.2; }
  h2 { margin: 0 0 .25rem; font-size: 1.15rem; }
  .subtle { color: #aeb8c6; font-size: .875rem; }
  .invite { margin: .5rem 0 1rem; padding: 1rem; border: 1px solid #426e54; border-radius: .65rem; background: #192b20; }
  .invite .subtle { margin: .25rem 0 0; color: #c9e8d2; }
  .demo { margin: .5rem 0 0; padding: 1rem; border: 1px solid #3f5f8f; border-radius: .65rem; background: #172234; }
  .demo .subtle { margin: .25rem 0 .5rem; color: #c3d3ea; }
  .guest-note { margin: .5rem 0 0; }
  .or { margin: 1rem 0 0; text-align: center; color: #aeb8c6; }
  .mode-switch { display: grid; grid-template-columns: 1fr 1fr; gap: .5rem; margin: 1rem 0; }
  .mode-switch button { min-height: 2.75rem; margin: 0; border: 1px solid #697586; background: transparent; color: #f2f4f7; }
  .mode-switch button.active { background: #d9e5f5; color: #151a22; }
  form { display: grid; gap: .5rem; margin-top: .75rem; }
  label { margin-top: .4rem; font-weight: 650; }
  input {
    box-sizing: border-box; width: 100%; min-height: 3rem; padding: .65rem .75rem; border: 1px solid #606b7a;
    border-radius: .5rem; background: #0f1217; color: inherit; font: inherit;
  }
  input:focus-visible, button:focus-visible { outline: 3px solid #84b7ff; outline-offset: 2px; }
  button {
    width: 100%; min-height: 3rem; margin-top: .4rem; padding: .65rem .85rem; border: 0; border-radius: .5rem;
    background: #d9e5f5; color: #151a22; cursor: pointer; font: inherit; font-weight: 750;
  }
  button:disabled { cursor: wait; opacity: .65; }
  button.secondary { border: 1px solid #697586; background: transparent; color: #f2f4f7; }
  button.link { width: auto; min-height: 2.75rem; margin: 0; padding: 0 .25rem; background: none; color: #84b7ff; font-weight: 600; }
  .warning, .error, .notice { padding: .7rem .8rem; border-radius: .5rem; overflow-wrap: anywhere; font-size: .875rem; }
  .warning { border: 1px solid #806628; background: #382e17; color: #ffdf8a; }
  .error { border: 1px solid #87464c; background: #381f23; color: #ffc8cd; }
  .notice { border: 1px solid #426e54; background: #192b20; color: #a9e8bb; }
</style>
