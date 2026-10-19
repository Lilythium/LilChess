<script lang="ts">
  import { auth, logout } from "../auth.svelte";
  import { route } from "../router.svelte";
  import { navCounts } from "../navCounts.svelte";
  import { activeTab } from "../navTabs";
  import { displayName } from "../format";
  import { askConfirm } from "../confirm";
  import BottomSheet from "./BottomSheet.svelte";

  // Phone tab bar: the four things people open most, plus "More" for the rest of the header menu.
  let moreOpen = $state(false);
  $effect(() => { void route.path; moreOpen = false; });

  const tab = $derived(activeTab(route.path));
  const profileHref = $derived("#/u/" + encodeURIComponent(auth.user?.username ?? ""));

  async function onLogout() {
    moreOpen = false;
    if (auth.user?.is_guest) {
      const ok = await askConfirm("Guest accounts can't be recovered after logging out. Log out anyway?",
        { confirmLabel: "Log out", danger: true });
      if (!ok) return;
    }
    void logout();
  }
</script>

<nav class="bottom-nav" aria-label="Main">
  <a class="tab" class:active={tab === "play"} aria-current={tab === "play" ? "page" : undefined} href="#/">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
    <span>Play</span>
  </a>
  <a class="tab" class:active={tab === "games"} aria-current={tab === "games" ? "page" : undefined} href="#/games">
    <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 12h16M12 4v16" /></svg>
    <span>My games</span>
    {#if navCounts.yourTurn > 0}<b class="badge" aria-label="{navCounts.yourTurn} games waiting for your move">{navCounts.yourTurn}</b>{/if}
  </a>
  <a class="tab" class:active={tab === "watch"} aria-current={tab === "watch" ? "page" : undefined} href="#/watch">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" /><circle cx="12" cy="12" r="3" /></svg>
    <span>Watch</span>
  </a>
  <a class="tab" class:active={tab === "tournaments"} aria-current={tab === "tournaments" ? "page" : undefined} href="#/tournaments">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" /></svg>
    <span>Events</span>
  </a>
  <button class="tab" class:active={tab === "more"} type="button" aria-haspopup="dialog" aria-expanded={moreOpen} onclick={() => (moreOpen = true)}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></svg>
    <span>More</span>
    {#if navCounts.simulInvites > 0}<b class="badge dot" aria-label="{navCounts.simulInvites} simul invitations"></b>{/if}
  </button>
</nav>

{#if moreOpen}
  <BottomSheet title="More" onClose={() => (moreOpen = false)}>
    <div class="menu">
      <a href="#/simuls" onclick={() => (moreOpen = false)}>Simuls{#if navCounts.simulInvites > 0} <b class="badge">{navCounts.simulInvites}</b>{/if}</a>
      <a href="#/leaderboard" onclick={() => (moreOpen = false)}>Leaderboard</a>
      <a href="#/games-db" onclick={() => (moreOpen = false)}>Games database</a>
      {#if auth.user?.is_admin}<a href="#/admin" onclick={() => (moreOpen = false)}>Admin</a>{/if}
      <a href={profileHref} onclick={() => (moreOpen = false)}>{displayName(auth.user?.username ?? "")}</a>
      <a href="#/settings" onclick={() => (moreOpen = false)}>Settings</a>
      <button type="button" class="logout" onclick={onLogout}>{auth.user?.is_guest ? "Register" : "Log out"}</button>
    </div>
  </BottomSheet>
{/if}

<style>
  .bottom-nav {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 90; display: flex;
    height: calc(var(--bottomnav-h) + env(safe-area-inset-bottom, 0px));
    padding: 0 env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px);
    background: #1f1d19; border-top: 1px solid rgba(255, 255, 255, 0.1);
  }
  .tab {
    position: relative; flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 2px; padding: 0; border: 0; border-radius: 0; background: transparent; color: #b0b0b0;
    font-size: 0.68rem; font-weight: 600; letter-spacing: 0.02em; text-decoration: none;
  }
  .tab svg { width: 24px; height: 24px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .tab.active { color: var(--text-hi); box-shadow: inset 0 2px 0 var(--green); }
  .tab.active svg { stroke: var(--green-hi); }
  .tab span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .badge { background: #629924; color: #fff; border-radius: 10px; padding: 0 0.4rem; font-size: 0.72rem; line-height: 1.3; }
  .tab .badge { position: absolute; top: 6px; left: calc(50% + 6px); }
  .tab .badge.dot { padding: 0; width: 9px; height: 9px; top: 9px; left: calc(50% + 8px); }

  .menu { display: flex; flex-direction: column; }
  .menu a, .menu button {
    display: flex; align-items: center; gap: 0.5rem; min-height: 52px; padding: 0 1.25rem; border: 0; border-radius: 0;
    border-top: 1px solid var(--border); background: transparent; color: var(--text-hi); font: inherit; text-align: left;
  }
  .menu .logout { color: #e38c84; }
</style>
