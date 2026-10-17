<script lang="ts">
  import { onMount } from "svelte";
  import {
    loginNative,
    logoutNative,
    registerNative,
    restoreNativeSession,
    type NativeSession,
  } from "../../../mobile/src/nativeAuth.js";
  import type { RegistrationMode } from "../../../mobile/src/serverSelection.js";

  let { serverUrl, registrationMode }: {
    serverUrl: string;
    registrationMode: RegistrationMode;
  } = $props();

  let session = $state<NativeSession | null>(null);
  let mode = $state<"login" | "register">("login");
  let username = $state("");
  let password = $state("");
  let inviteCode = $state("");
  let busy = $state(false);
  let restoring = $state(true);
  let errorMessage = $state<string | null>(null);
  let notice = $state<string | null>(null);

  onMount(() => {
    void restore();
  });

  async function restore(): Promise<void> {
    restoring = true;
    try {
      session = await restoreNativeSession(serverUrl);
    } catch (error) {
      errorMessage = messageOf(error, "Could not restore the saved session. Check the connection and try again.");
    } finally {
      restoring = false;
    }
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    errorMessage = null;
    notice = null;
    busy = true;
    try {
      session = mode === "login"
        ? await loginNative(serverUrl, username.trim(), password)
        : await registerNative(serverUrl, username.trim(), password, inviteCode);
      password = "";
      inviteCode = "";
    } catch (error) {
      errorMessage = messageOf(error, "Authentication failed. Check the details and try again.");
    } finally {
      busy = false;
    }
  }

  async function signOut(): Promise<void> {
    if (!session) return;
    errorMessage = null;
    notice = null;
    busy = true;
    const activeSession = session;
    // Sign the user out of the UI even when the server is offline. The service always attempts
    // to clear the device token; an error tells the user that remote revocation was not confirmed.
    session = null;
    try {
      await logoutNative(serverUrl, activeSession);
      notice = "Signed out and the server session was revoked.";
    } catch (error) {
      errorMessage = messageOf(error, "Signed out on this device, but server revocation could not be confirmed.");
    } finally {
      password = "";
      busy = false;
    }
  }

  function messageOf(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback;
  }
</script>

<section class="auth-card" aria-labelledby="auth-title">
  {#if restoring}
    <p class="auth-status" role="status">Restoring the saved session securely…</p>
  {:else if session}
    <h2 id="auth-title">Signed in</h2>
    <p class="account-name">{session.user.username}{session.user.is_guest ? " (guest)" : ""}</p>
    <p class="subtle">This session is stored securely on this device and belongs only to {serverUrl}.</p>
    <button class="secondary" type="button" onclick={signOut} disabled={busy}>
      {busy ? "Signing out…" : "Log out"}
    </button>
  {:else}
    <h2 id="auth-title">{mode === "login" ? "Sign in" : "Create an account"}</h2>
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
    <p class="subtle guest-note">Guest sessions are issued only for valid, non-targeted challenge invites. Invite-link navigation is handled in a later phase.</p>
  {/if}
  {#if errorMessage}
    <p class="error" role="alert">{errorMessage}</p>
  {/if}
  {#if notice}
    <p class="notice" role="status">{notice}</p>
  {/if}
</section>

<style>
  .auth-card { margin-top: 1rem; padding: 1rem; border: 1px solid #333b47; border-radius: .7rem; background: #13171d; }
  h2 { margin: 0 0 .5rem; font-size: 1.2rem; }
  .subtle, .auth-status { color: #aeb8c6; font-size: .875rem; }
  .account-name { margin: .5rem 0; overflow-wrap: anywhere; font-weight: 750; }
  .mode-switch { display: grid; grid-template-columns: 1fr 1fr; gap: .5rem; margin: 1rem 0; }
  .mode-switch button { min-height: 2.5rem; margin: 0; border: 1px solid #697586; background: transparent; color: #f2f4f7; }
  .mode-switch button.active { background: #d9e5f5; color: #151a22; }
  form { display: grid; gap: .5rem; margin-top: .75rem; }
  label { margin-top: .4rem; font-weight: 650; }
  input { box-sizing: border-box; width: 100%; min-height: 2.8rem; padding: .65rem .75rem; border: 1px solid #606b7a; border-radius: .5rem; background: #0f1217; color: inherit; font: inherit; }
  button { min-height: 2.8rem; margin-top: .4rem; padding: .65rem .85rem; border: 0; border-radius: .5rem; background: #d9e5f5; color: #151a22; cursor: pointer; font: inherit; font-weight: 750; }
  button:disabled { cursor: wait; opacity: .65; }
  button.secondary { width: 100%; border: 1px solid #697586; background: transparent; color: #f2f4f7; }
  .guest-note { margin-bottom: 0; }
  .error, .notice { padding: .7rem .8rem; border-radius: .5rem; overflow-wrap: anywhere; font-size: .875rem; }
  .error { border: 1px solid #87464c; background: #381f23; color: #ffc8cd; }
  .notice { border: 1px solid #426e54; background: #192b20; color: #a9e8bb; }
</style>
