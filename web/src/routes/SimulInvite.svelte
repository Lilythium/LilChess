<script lang="ts">
  import { onMount } from "svelte";
  import { VARIANT_LABELS, type Variant } from "@lilchess/shared";
  import { api } from "../lib/api";
  import { auth } from "../lib/auth.svelte";
  import { displayName } from "../lib/format";
  import { navigate } from "../lib/router.svelte";
  import { simulClock } from "../lib/simul/format";
  import Login from "./Login.svelte";
  import OpenInApp from "../lib/components/OpenInApp.svelte";

  interface Preview {
    name: string; hostName: string; status: string; mode: "live" | "correspondence"; variant: Variant;
    initialMs: number | null; incrementMs: number | null; daysPerMove: number | null; hostExtraMs: number;
    maxPlayers: number; accepted: number; isPublic: boolean;
  }

  let { code }: { code: string } = $props();

  let preview = $state<Preview | null>(null);
  let error = $state<string | null>(null);
  let busy = $state(false);
  let showLogin = $state(false);

  onMount(() => {
    void (async () => {
      try {
        preview = (await api<{ invite: Preview }>(`/api/simul-invites/${code}`)).invite;
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
    })();
  });

  async function join() {
    busy = true;
    error = null;
    try {
      const r = await api<{ simulId: string }>(`/api/simuls/join-code/${code}`, { method: "POST" });
      navigate(`/simul/${r.simulId}`);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  const isOwn = $derived(!!preview && auth.user?.username === preview.hostName);
  const open = $derived(preview?.status === "open");
  const full = $derived(!!preview && preview.accepted >= preview.maxPlayers);
</script>

<div class="panel card">
  {#if !preview && error}
    <h1>Invite unavailable</h1>
    <p class="error">{error}</p>
    <a href="#/">Go to LilChess</a>
  {:else if !preview}
    <p class="muted">Loading…</p>
  {:else}
    <h1>{displayName(preview.hostName)} invited you to a simul</h1>
    <OpenInApp target={{ kind: "simul", code }} />
    <p><strong>{preview.name}</strong></p>
    <p>
      {simulClock(preview)} · {VARIANT_LABELS[preview.variant]} · {preview.accepted}/{preview.maxPlayers} players
      {#if preview.mode === "live" && preview.hostExtraMs > 0}
        <span class="muted"> · host gets +{preview.hostExtraMs / 60_000} min</span>
      {/if}
    </p>
    <p class="muted">
      A simul is one player (the host) playing everyone at once. Your game is casual, and takebacks are off.
    </p>

    {#if error}<p class="error">{error}</p>{/if}

    {#if !open}
      <p class="muted">This simul {preview.status === "cancelled" ? "was cancelled" : "has already started"}.</p>
      <a href="#/simuls">See simuls</a>
    {:else if auth.user}
      {#if isOwn}
        <p class="muted">This is your own invite link. Send it to the people you want to play.</p>
        <a href="#/simuls">Back to simuls</a>
      {:else if auth.user.is_guest}
        <p class="muted">Guests can't join simuls. Log out and register an account to take part.</p>
      {:else if full}
        <p class="muted">This simul is full.</p>
        <a href="#/simuls">See other simuls</a>
      {:else}
        <button class="primary" disabled={busy} onclick={join}>Join simul</button>
      {/if}
    {:else}
      <div class="stack">
        <button class="primary" onclick={() => (showLogin = !showLogin)}>Log in or register to join</button>
        {#if showLogin}<Login embedded />{/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .card { max-width: 420px; margin: clamp(1rem, 8vh, 4rem) auto; }
  .stack { display: flex; flex-direction: column; gap: 0.75rem; }
</style>