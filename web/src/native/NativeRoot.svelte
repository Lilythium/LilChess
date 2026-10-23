<script lang="ts">
  import { onMount } from "svelte";
  import App from "../App.svelte";
  import ServerSelect from "./ServerSelect.svelte";
  import NativeAuth from "./NativeAuth.svelte";
  import { activateNativeServer, deactivateNativeServer } from "./activate";
  import { setLogoutHandler, setSignedInUser, type User } from "../lib/auth.svelte";
  import { setPlatformServices } from "../lib/platform";
  import { navigate, route } from "../lib/router.svelte";
  import { listenForInviteLinks, readLaunchInvite } from "../../../mobile/src/deepLinks.js";
  import { inviteRoute, sameServer, type InviteLink } from "../../../mobile/src/inviteLink.js";
  import { logoutNative, restoreNativeSession, type NativeSession } from "../../../mobile/src/nativeAuth.js";
  import { nativeCopy, nativeShare } from "../../../mobile/src/nativePlatform.js";
  import {
    SERVER_URL_STORAGE_KEY,
    unavailableFeatures,
    type LilChessHealth,
    type NormalizedServerAddress,
  } from "../../../mobile/src/serverSelection.js";

  // The app shell. It owns everything that happens before and around the shared web UI: which server, whether
  // there is a session on it, which invite (if any) the person is trying to open. The game UI (App) only mounts
  // once a verified session exists, so it never has to deal with a logged-out state of its own.
  //
  //   boot -> server -> restoring -> auth -> app
  //
  // Two rules hold throughout: sessions belong to one server, and an invite link only ever names a server and a
  // target. It is never authentication, and it never moves the app to another server without the person agreeing.
  type Stage = "boot" | "server" | "restoring" | "auth" | "app";

  let stage = $state<Stage>("boot");
  let server = $state<{ url: string; health: LilChessHealth } | null>(null);
  let pendingInvite = $state<InviteLink | null>(null);
  let incoming = $state<InviteLink | null>(null);
  let notice = $state<string | null>(null);
  let restoreError = $state<string | null>(null);
  let autoAddress = $state("");
  let prefillAddress = $state("");
  let serverKey = $state(0);

  let currentSession: NativeSession | null = null;

  onMount(() => {
    let disposed = false;
    let stopListening: (() => void) | null = null;
    void (async () => {
      let launch: InviteLink | null = null;
      try {
        launch = await readLaunchInvite();
      } catch {
        // No deep-link support (plain browser during development): carry on without one.
      }
      autoAddress = readSavedServer() ?? "";
      showServerPicker();
      if (launch) handleInvite(launch);
      try {
        const stop = await listenForInviteLinks(handleInvite);
        if (disposed) stop();
        else stopListening = stop;
      } catch {
        // Same as above.
      }
    })();
    return () => {
      disposed = true;
      stopListening?.();
    };
  });

  function readSavedServer(): string | null {
    try {
      return localStorage.getItem(SERVER_URL_STORAGE_KEY);
    } catch {
      return null;
    }
  }

  function showServerPicker(): void {
    serverKey += 1;
    stage = "server";
  }

  /** A link arrived (cold start, or while the app was open). */
  function handleInvite(link: InviteLink): void {
    const saved = readSavedServer();
    const connectedTo = server?.url ?? saved;
    if (connectedTo && sameServer(link.serverUrl, connectedTo)) {
      if (stage === "app") openInvite(link);
      else pendingInvite = link;
      return;
    }
    // Another server (or none yet): ask first. Credentials and sessions never move between servers.
    if (incoming && sameServer(incoming.serverUrl, link.serverUrl)) return;
    incoming = link;
  }

  function acceptIncoming(): void {
    const link = incoming;
    incoming = null;
    if (!link) return;
    if (stage === "app") teardownApp();
    server = null;
    notice = null;
    pendingInvite = link;
    autoAddress = link.serverUrl;
    prefillAddress = "";
    showServerPicker();
  }

  function openInvite(link: InviteLink): void {
    const path = inviteRoute(link.target);
    navigate(path);
    route.path = path; // the hashchange event arrives a tick later; the app must not resume a game over it
  }

  function onconnected(target: NormalizedServerAddress, health: LilChessHealth): void {
    server = { url: target.serverUrl, health };
    if (pendingInvite && !sameServer(pendingInvite.serverUrl, target.serverUrl)) pendingInvite = null;
    void restore();
  }

  async function restore(): Promise<void> {
    if (!server) return;
    stage = "restoring";
    restoreError = null;
    try {
      const session = await restoreNativeSession(server.url);
      if (session) enterApp(session);
      else stage = "auth";
    } catch (error) {
      // Unreachable or erroring server: the saved token is untouched, so offer a retry instead of a login form.
      restoreError = error instanceof Error && error.message
        ? error.message
        : "Could not restore the saved session. Check the connection and try again.";
    }
  }

  /** A demo game was started on this server: sign in as the new guest and land on the game, not the lobby. */
  function enterDemo(session: NativeSession, gameId: string): void {
    if (!server) return;
    pendingInvite = null;
    enterApp(session);
    const path = `/game/${gameId}`;
    navigate(path);
    route.path = path;
  }

  function enterApp(session: NativeSession): void {
    if (!server) return;
    const { url, health } = server;
    currentSession = session;
    notice = null;

    activateNativeServer(url, () => leaveApp("Your session ended. Sign in again."));
    setPlatformServices({
      publicOrigin: url,
      copyText: nativeCopy,
      share: nativeShare,
      server: { url, version: health.version, switchServer: changeServer, unavailable: unavailableFeatures(health) },
    });
    setLogoutHandler(signOut);
    setSignedInUser(session.user as User);

    const invite = pendingInvite && sameServer(pendingInvite.serverUrl, url) ? pendingInvite : null;
    pendingInvite = null;
    if (invite) {
      openInvite(invite);
    } else {
      navigate("/");
      route.path = "/"; // a hash left over from a previous account must not decide where this one lands
    }
    stage = "app";
  }

  /** Close sockets and forget the user. The stored token for the server is left alone. */
  function teardownApp(): void {
    deactivateNativeServer();
    setLogoutHandler(null);
    setPlatformServices(null);
    setSignedInUser(null);
    currentSession = null;
  }

  /** The server rejected or lost the session while the app was open. */
  function leaveApp(message: string): void {
    if (stage !== "app") return;
    teardownApp();
    notice = message;
    stage = "auth";
  }

  async function signOut(): Promise<void> {
    const session = currentSession;
    const url = server?.url;
    teardownApp();
    pendingInvite = null;
    stage = "auth";
    notice = null;
    if (!session || !url) return;
    // The UI is signed out even if the server is unreachable; logoutNative always clears the device token and
    // throws only to say that revoking the server-side session could not be confirmed.
    try {
      await logoutNative(url, session);
      notice = "Signed out. The server session was revoked.";
    } catch {
      notice = "Signed out on this device, but the server could not confirm revoking the session.";
    }
  }

  function changeServer(): void {
    if (stage === "app") teardownApp();
    prefillAddress = server?.url ?? readSavedServer() ?? "";
    autoAddress = "";
    server = null;
    pendingInvite = null;
    notice = null;
    showServerPicker();
  }

  const inviteKey = $derived(pendingInvite ? JSON.stringify(pendingInvite.target) : "none");
  const incomingHost = $derived(incoming?.serverUrl.replace(/^https?:\/\//, "") ?? "");
  const currentHost = $derived((server?.url ?? readSavedServer())?.replace(/^https?:\/\//, "") ?? null);
</script>

{#if stage === "boot"}
  <main class="plain" role="status">Loading…</main>
{:else if stage === "server"}
  {#key serverKey}
    <ServerSelect
      initialAddress={autoAddress}
      {prefillAddress}
      {notice}
      waitingInvite={pendingInvite !== null}
      {onconnected}
    />
  {/key}
{:else if stage === "restoring"}
  <main class="plain">
    {#if restoreError}
      <section class="card" aria-labelledby="restore-title">
        <h1 id="restore-title">Can't reach your session</h1>
        <p class="error" role="alert">{restoreError}</p>
        <button type="button" onclick={() => void restore()}>Try again</button>
        <button class="secondary" type="button" onclick={changeServer}>Change server</button>
      </section>
    {:else}
      <p role="status">Restoring your session…</p>
    {/if}
  </main>
{:else if stage === "auth" && server}
  {#key inviteKey}
    <NativeAuth
      serverUrl={server.url}
      health={server.health}
      invite={pendingInvite}
      {notice}
      onsession={enterApp}
      ondemo={enterDemo}
      onchangeserver={changeServer}
      ondropinvite={() => (pendingInvite = null)}
    />
  {/key}
{:else if stage === "app"}
  <App />
{/if}

{#if incoming}
  <div class="scrim">
    <div class="card dialog" role="alertdialog" aria-modal="true" aria-labelledby="incoming-title" aria-describedby="incoming-body">
      <h1 id="incoming-title">Open this invite on {incomingHost}?</h1>
      <p id="incoming-body">
        {#if currentHost}
          You're connected to {currentHost}. Opening the invite connects the app to {incomingHost} instead; you stay
          signed in on {currentHost}, and signing in on {incomingHost} is separate.
        {:else}
          The invite is for the LilChess server at {incomingHost}. Only continue if you trust it.
        {/if}
      </p>
      {#if incoming.serverUrl.startsWith("http://")}
        <p class="warning">This server uses unencrypted HTTP. Use it only on a trusted local network.</p>
      {/if}
      <button type="button" onclick={acceptIncoming}>Connect to {incomingHost}</button>
      <button class="secondary" type="button" onclick={() => (incoming = null)}>Ignore invite</button>
    </div>
  </div>
{/if}

<style>
  .plain {
    box-sizing: border-box; min-height: 100dvh; display: grid; place-items: center; padding: 1.25rem;
    padding-top: max(1.25rem, env(safe-area-inset-top, 0px)); padding-bottom: max(1.25rem, env(safe-area-inset-bottom, 0px));
    background: #101318; color: #f2f4f7; font: 16px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  .scrim {
    position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center; padding: 1.25rem;
    background: #000a; font: 16px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #f2f4f7;
  }
  .card {
    box-sizing: border-box; width: min(100%, 30rem); padding: 1.5rem; border: 1px solid #333b47; border-radius: 1rem;
    background: #191e26;
  }
  h1 { margin: 0 0 .75rem; font-size: 1.3rem; line-height: 1.25; overflow-wrap: anywhere; }
  p { margin: 0 0 1rem; color: #c1c9d4; }
  button {
    width: 100%; min-height: 3rem; margin-top: .4rem; padding: .65rem .85rem; border: 0; border-radius: .5rem;
    background: #d9e5f5; color: #151a22; cursor: pointer; font: inherit; font-weight: 750; overflow-wrap: anywhere;
  }
  button.secondary { border: 1px solid #697586; background: transparent; color: #f2f4f7; }
  button:focus-visible { outline: 3px solid #84b7ff; outline-offset: 2px; }
  .warning, .error { padding: .7rem .8rem; border-radius: .5rem; font-size: .9rem; overflow-wrap: anywhere; }
  .warning { border: 1px solid #806628; background: #382e17; color: #ffdf8a; }
  .error { border: 1px solid #87464c; background: #381f23; color: #ffc8cd; }
</style>
