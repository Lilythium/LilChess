<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { auth, playAsGuest } from "../lib/auth.svelte";
  import { navigate } from "../lib/router.svelte";
  import { displayName, timeControl } from "../lib/format";
  import Login from "./Login.svelte";

  interface InviteInfo {
    id: string; from_name: string; mode: "live" | "correspondence";
    initial_ms: number | null; increment_ms: number | null; days_per_move: number | null;
    color_pref: string | null; variant: string;
  }

  let { id }: { id: string } = $props();

  let invite = $state<InviteInfo | null>(null);
  let guestsAllowed = $state(false);
  let error = $state<string | null>(null);
  let busy = $state(false);
  let showLogin = $state(false);
  let autoAccepting = $state(false);
  let autoAcceptAttempted = false;

  async function accept() {
    busy = true;
    error = null;
    try {
      const r = await api<{ gameId: string }>(`/api/challenges/${id}/accept`, { method: "POST" });
      navigate(`/game/${r.gameId}`);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
      autoAccepting = false;
    }
  }

  async function guest() {
    busy = true;
    error = null;
    try {
      await playAsGuest(id);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      busy = false;
    }
  }

  onMount(() => {
    void (async () => {
      try {
        const r = await api<{ invite: InviteInfo; guestsAllowed: boolean }>(`/api/invites/${id}`);
        invite = r.invite;
        guestsAllowed = r.guestsAllowed;
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
    })();
  });

  const yourColor = $derived(
    invite?.color_pref ? (invite.color_pref === "white" ? "black" : "white") : null,
  );
  const isOwn = $derived(!!invite && auth.user?.username === invite.from_name);

  $effect(() => {
    if (!invite || !auth.user || isOwn || autoAcceptAttempted) return;
    autoAcceptAttempted = true;
    autoAccepting = true;
    void accept();
  });
</script>

<div class="panel card">
  {#if !invite && error}
    <h1>Invite unavailable</h1>
    <p class="error">{error}</p>
    <a href="#/">Go to LilChess</a>
  {:else if !invite}
    <p class="muted">Loading…</p>
  {:else}
    <h1>{displayName(invite.from_name)} invited you to play</h1>
    <p>
      {timeControl(invite)} · {invite.mode} · {invite.variant}
      {#if yourColor}<span class="muted"> · you play {yourColor}</span>{/if}
    </p>

    {#if error}<p class="error">{error}</p>{/if}

    {#if auth.user}
      {#if isOwn}
        <p class="muted">This is your own invite link. Send it to your opponent.</p>
        <a href="#/">Back to lobby</a>
      {:else if autoAccepting}
        <p class="muted">Accepting challenge…</p>
      {:else}
        <button class="primary" disabled={busy} onclick={accept}>Accept challenge</button>
      {/if}
    {:else}
      <div class="stack">
        {#if guestsAllowed}
          <button class="primary" disabled={busy} onclick={guest}>Play as guest</button>
          <span class="muted">
            Guests have no password. If you clear your browser data, use a private window, or switch
            device, you will lose access to this game. Register to keep it.
          </span>
        {/if}
        <button disabled={busy} onclick={() => (showLogin = !showLogin)}>Log in or register</button>
        {#if showLogin}<Login embedded />{/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .card { max-width: 420px; margin: clamp(1rem, 8vh, 4rem) auto; }
  .stack { display: flex; flex-direction: column; gap: 0.75rem; }
</style>