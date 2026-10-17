<script lang="ts">
  import { onMount } from "svelte";
  import { CapacitorHttp } from "@capacitor/core";
  import NativeAuth from "./NativeAuth.svelte";
  import {
    SERVER_URL_STORAGE_KEY,
    ServerSelectionError,
    describeConnectionFailure,
    normalizeServerAddress,
    validateHealthResponse,
    type LilChessHealth,
    type NormalizedServerAddress,
  } from "../../../mobile/src/serverSelection.js";

  let address = $state("");
  let editing = $state(true);
  let checking = $state(false);
  let selectedServer = $state<NormalizedServerAddress | null>(null);
  let health = $state<LilChessHealth | null>(null);
  let errorMessage = $state<string | null>(null);

  onMount(() => {
    try {
      const saved = localStorage.getItem(SERVER_URL_STORAGE_KEY);
      if (!saved) return;
      address = saved;
      editing = false;
      void checkAndSelect(saved);
    } catch {
      errorMessage = "Local storage is unavailable. Enable app storage to save a server address on this device.";
    }
  });

  async function checkAndSelect(raw = address): Promise<void> {
    errorMessage = null;

    let target: NormalizedServerAddress;
    try {
      target = normalizeServerAddress(raw);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Enter a valid server address.";
      selectedServer = null;
      health = null;
      editing = true;
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

      selectedServer = target;
      health = compatibleHealth;
      address = target.serverUrl;
      editing = false;
    } catch (error) {
      selectedServer = null;
      health = null;
      errorMessage = describeConnectionFailure(error, target);
      editing = true;
    } finally {
      checking = false;
    }
  }

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    void checkAndSelect();
  }

  function changeServer(): void {
    address = "";
    selectedServer = null;
    health = null;
    errorMessage = null;
    editing = true;
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

    {#if !editing}
      {#if checking}
        <p class="status" role="status">Checking the saved server…</p>
      {:else if selectedServer && health}
        <div class="success" role="status">
          <span class="status-title">Compatible LilChess server</span>
          <strong class="server-address">{selectedServer.serverUrl}</strong>
          <dl>
            <div><dt>Server version</dt><dd>{health.version}</dd></div>
            <div><dt>API version</dt><dd>{health.apiVersion}</dd></div>
            <div><dt>Registration</dt><dd>{health.features.registration}</dd></div>
            <div><dt>Guest access</dt><dd>{health.features.guests ? "Available" : "Disabled"}</dd></div>
          </dl>
        </div>
        {#if selectedServer.serverUrl.startsWith("http://")}
          <p class="warning">This connection uses unencrypted HTTP. Use it only on a trusted local network. The app will not silently switch protocols.</p>
        {/if}
        <NativeAuth serverUrl={selectedServer.serverUrl} registrationMode={health.features.registration} />
        <button class="secondary" type="button" onclick={changeServer}>Change server</button>
      {/if}
    {/if}

    {#if editing}
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
          <p class="warning">HTTP is unencrypted. Use it only for a trusted local network, and only where the device permits it.</p>
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
  .helper, .note, .footnote { color: #aeb8c6; font-size: .875rem; }
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
  button.secondary { border: 1px solid #697586; background: transparent; color: #f2f4f7; }
  .warning, .error { padding: .75rem .85rem; border-radius: .5rem; font-size: .9rem; }
  .warning { border: 1px solid #806628; background: #382e17; color: #ffdf8a; }
  .error { border: 1px solid #87464c; background: #381f23; color: #ffc8cd; }
  .status { color: #c1c9d4; }
  .success { margin: 1.25rem 0; padding: 1rem; border: 1px solid #426e54; border-radius: .65rem; background: #192b20; }
  .status-title { display: block; margin-bottom: .35rem; color: #a9e8bb; font-size: .875rem; font-weight: 750; }
  .server-address { overflow-wrap: anywhere; }
  dl { margin: .9rem 0 0; }
  dl div { display: flex; justify-content: space-between; gap: 1rem; padding: .35rem 0; border-top: 1px solid #ffffff18; }
  dt { color: #c1c9d4; }
  dd { margin: 0; text-align: right; text-transform: capitalize; }
</style>
