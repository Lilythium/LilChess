<script lang="ts">
  import { onMount } from "svelte";
  import { CapacitorHttp } from "@capacitor/core";
  import {
    SERVER_URL_STORAGE_KEY,
    ServerSelectionError,
    describeConnectionFailure,
    normalizeServerAddress,
    validateHealthResponse,
    type LilChessHealth,
    type NormalizedServerAddress,
  } from "../../../mobile/src/serverSelection.js";

  // The picker only picks. Signing in, restoring a session and the game UI are the shell's job (NativeRoot):
  // once a server is verified and saved it is handed over through `onconnected`.
  let { initialAddress = "", prefillAddress = "", notice = null, waitingInvite = false, onconnected }: {
    /** A saved server, or one the person just agreed to switch to for an invite. Checked straight away. */
    initialAddress?: string;
    /** Only fills the field (for example the current server when the person asked to switch): nothing is contacted. */
    prefillAddress?: string;
    notice?: string | null;
    waitingInvite?: boolean;
    onconnected: (server: NormalizedServerAddress, health: LilChessHealth) => void;
  } = $props();

  let address = $state("");
  let checking = $state(false);
  let autoChecking = $state(false);
  let errorMessage = $state<string | null>(null);

  onMount(() => {
    if (!initialAddress) {
      address = prefillAddress;
      return;
    }
    address = initialAddress;
    autoChecking = true;
    void checkAndSelect(initialAddress).finally(() => { autoChecking = false; });
  });

  async function checkAndSelect(raw = address): Promise<void> {
    errorMessage = null;

    let target: NormalizedServerAddress;
    try {
      target = normalizeServerAddress(raw);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Enter a valid server address.";
      return;
    }

    checking = true;
    try {
      // Use Capacitor's native HTTP bridge, not WebView fetch: the server intentionally does
      // not grant cross-origin WebView access or relax its CSRF/Origin policy for the app.
      const response = await CapacitorHttp.get({
        url: target.healthUrl,
        headers: { Accept: "application/json" },
        connectTimeout: 8000,
        readTimeout: 8000,
        disableRedirects: true,
      });

      if (response.status === 404) {
        throw new ServerSelectionError(
          "not-lilchess",
          "No /api/health endpoint was found at this address. Enter the server origin, not a page or API path, and confirm it is a LilChess server.",
        );
      }
      if (response.status < 200 || response.status >= 300) {
        throw new ServerSelectionError(
          "http",
          `The server returned HTTP ${response.status} while checking /api/health. Check the address and server status.`,
        );
      }

      const compatibleHealth = validateHealthResponse(response.data);
      try {
        // Only a verified server origin is persisted. This is not authentication storage.
        localStorage.setItem(SERVER_URL_STORAGE_KEY, target.serverUrl);
      } catch {
        throw new ServerSelectionError(
          "storage",
          "The server is compatible, but this device could not save the selected address. Check app storage permissions and try again.",
        );
      }

      address = target.serverUrl;
      onconnected(target, compatibleHealth);
    } catch (error) {
      errorMessage = describeConnectionFailure(error, target);
    } finally {
      checking = false;
    }
  }

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    void checkAndSelect();
  }

  const explicitlyHttp = $derived(/^http:\/\//i.test(address.trim()));
</script>

<svelte:head>
  <title>Choose LilChess Server</title>
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
</svelte:head>

<main class="server-screen">
  <section class="panel" aria-labelledby="server-title">
    <p class="eyebrow">LILCHESS MOBILE</p>
    <h1 id="server-title">Choose a server</h1>
    <p class="intro">Connect to a LilChess server you trust. The address is checked before it is saved.</p>

    {#if notice}
      <p class="notice" role="status">{notice}</p>
    {/if}
    {#if waitingInvite}
      <p class="notice" role="status">You opened an invite. Connect to its server to continue.</p>
    {/if}

    {#if autoChecking && checking}
      <p class="status" role="status">Connecting to {address}…</p>
    {:else}
      <form onsubmit={submit}>
        <label for="server-address">Server address</label>
        <input
          id="server-address"
          bind:value={address}
          type="text"
          inputmode="url"
          autocomplete="url"
          autocapitalize="off"
          spellcheck="false"
          placeholder="chess.example.com"
          disabled={checking}
          required
        />
        <p class="helper">Enter a hostname or IP address. HTTPS is assumed when you do not specify a scheme. Do not include a username or password.</p>
        {#if explicitlyHttp}
          <p class="warning">HTTP is unencrypted. Use it only for a trusted local network, and only where the device permits it. The app will not silently switch protocols.</p>
        {/if}
        <button type="submit" disabled={checking || !address.trim()}>
          {checking ? "Checking server…" : "Test and select server"}
        </button>
      </form>
    {/if}

    {#if errorMessage}
      <p class="error" role="alert">{errorMessage}</p>
    {/if}

    <p class="footnote">Server URLs are kept separately from account credentials. Changing the server does not require reinstalling the app.</p>
  </section>
</main>

<style>
  .server-screen {
    box-sizing: border-box;
    min-height: 100dvh;
    display: grid;
    justify-items: center;
    align-items: center;
    /* "safe": when the keyboard leaves less room than the card needs, start at the top instead of clipping it. */
    align-items: safe center;
    padding: max(1.25rem, env(safe-area-inset-top, 0px)) max(1.25rem, env(safe-area-inset-right, 0px))
             max(1.25rem, env(safe-area-inset-bottom, 0px)) max(1.25rem, env(safe-area-inset-left, 0px));
    background: #101318;
    color: #f2f4f7;
    font: 16px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  .panel {
    box-sizing: border-box;
    width: min(100%, 34rem);
    padding: clamp(1.25rem, 5vw, 2.25rem);
    border: 1px solid #333b47;
    border-radius: 1rem;
    background: #191e26;
    box-shadow: 0 1.25rem 3.5rem #0005;
  }

  .eyebrow { margin: 0 0 .5rem; color: #a9b5c5; font-size: .75rem; font-weight: 750; letter-spacing: .14em; }
  h1 { margin: 0; font-size: clamp(1.75rem, 7vw, 2.25rem); line-height: 1.2; }
  .intro { margin: .8rem 0 1.5rem; color: #c1c9d4; }
  label { display: block; margin-bottom: .5rem; font-weight: 650; }
  input {
    box-sizing: border-box;
    width: 100%;
    min-height: 3rem;
    padding: .75rem .85rem;
    border: 1px solid #606b7a;
    border-radius: .55rem;
    background: #0f1217;
    color: inherit;
    font: inherit;
  }
  input:focus-visible, button:focus-visible { outline: 3px solid #84b7ff; outline-offset: 2px; }
  .helper, .footnote { color: #aeb8c6; font-size: .875rem; }
  .helper { margin: .5rem 0 1rem; }
  .footnote { margin: 1.5rem 0 0; }
  button {
    width: 100%;
    min-height: 3rem;
    margin-top: .35rem;
    padding: .75rem 1rem;
    border: 0;
    border-radius: .55rem;
    background: #d9e5f5;
    color: #151a22;
    cursor: pointer;
    font: inherit;
    font-weight: 750;
  }
  button:disabled { cursor: wait; opacity: .65; }
  .warning, .error { padding: .75rem .85rem; border-radius: .5rem; font-size: .9rem; }
  .warning { border: 1px solid #806628; background: #382e17; color: #ffdf8a; }
  .error { border: 1px solid #87464c; background: #381f23; color: #ffc8cd; }
  .status { color: #c1c9d4; }
  .notice { padding: .75rem .85rem; border: 1px solid #426e54; border-radius: .5rem; background: #192b20; color: #a9e8bb; font-size: .9rem; }
</style>
