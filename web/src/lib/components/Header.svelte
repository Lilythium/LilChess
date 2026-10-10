<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../api";
  import { auth, logout } from "../auth.svelte";
  import { route } from "../router.svelte";
  import type { MyGames } from "../types";
  import { displayName } from "../format";

  let yourTurn = $state(0);
  let menuOpen = $state(false);

  async function poll() {
    if (document.hidden) return;
    try {
      const g = await api<MyGames>("/api/games/my-games");
      yourTurn = g.myTurn.length;
    } catch { }
  }

  onMount(() => {
    void poll();
    const t = setInterval(poll, 10_000);
    document.addEventListener("visibilitychange", poll);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", poll); };
  });

  $effect(() => {
    document.title = yourTurn > 0 ? `(${yourTurn}) LilChess` : "LilChess";
  });

  // Close the phone menu whenever the route changes.
  $effect(() => { void route.path; menuOpen = false; });

  const profileHref = $derived("#/u/" + encodeURIComponent(auth.user?.username ?? ""));

  const toggleMenu = () => (menuOpen = !menuOpen);
  const closeMenu = () => (menuOpen = false);

  function onLogout() {
    closeMenu();
    if (auth.user?.is_guest && !confirm("Guest accounts can't be recovered after logging out. Log out anyway?")) return;
    void logout();
  }
</script>

<svelte:window onkeydown={(e) => { if (e.key === "Escape") closeMenu(); }} />

<header>
  <a class="logo" href="#/" onclick={closeMenu}>LilChess</a>

  <button class="hamburger" onclick={toggleMenu} aria-label="Toggle navigation menu"
          aria-expanded={menuOpen} aria-controls="site-nav">
    <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
      {#if menuOpen}
        <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
      {:else}
        <line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line>
      {/if}
    </svg>
  </button>

  {#if menuOpen}<button class="scrim" aria-label="Close menu" onclick={closeMenu}></button>{/if}

  <nav id="site-nav" class:open={menuOpen}>
    <a href="#/" class="nav-item">PLAY</a>
    <a href="#/games" class="nav-item">MY GAMES{#if yourTurn > 0} <span class="badge">{yourTurn}</span>{/if}</a>
    <a href="#/watch" class="nav-item">WATCH</a>
    <a href="#/tournaments" class="nav-item">TOURNAMENTS</a>
    <a href="#/leaderboard" class="nav-item">LEADERBOARD</a>
    <a href={profileHref} class="nav-item">{displayName(auth.user?.username ?? "").toUpperCase()}</a>
    {#if !auth.user?.is_guest}<a href="#/settings" class="nav-item">SETTINGS</a>{/if}
    <button class="nav-item btn-logout" onclick={onLogout}>LOG OUT</button>
  </nav>
</header>

<style>
  header {
    position: relative; display: flex; justify-content: space-between; align-items: center;
    height: var(--header-h);
    padding: env(safe-area-inset-top, 0px) max(1rem, env(safe-area-inset-right, 0px)) 0 max(1rem, env(safe-area-inset-left, 0px));
    background: linear-gradient(to bottom, #2e2b26, #1f1d19);
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.3); z-index: 100;
  }
  .logo { color: #bababa; font-weight: bold; font-size: 1.25rem; text-decoration: none; display: flex; align-items: center; }
  .logo:hover { color: #ffffff; }
  nav { display: flex; align-items: center; height: 100%; }
  .nav-item {
    display: flex; align-items: center; height: 100%; padding: 0 0.9rem; color: #b0b0b0;
    font-size: 0.95rem; font-weight: 600; letter-spacing: 0.05em; text-decoration: none;
    background: transparent; border: none; border-radius: 0; cursor: pointer;
    transition: background-color 0.15s ease, color 0.15s ease;
  }
  @media (hover: hover) { .nav-item:hover { background-color: rgba(255, 255, 255, 0.12); color: #ffffff; } }
  .btn-logout { font-family: inherit; }
  .badge { background: #629924; color: #fff; border-radius: 10px; padding: 0 0.4rem; font-size: 0.75rem; margin-left: 0.4rem; }

  .hamburger {
    display: none; width: 44px; height: 44px; padding: 0; align-items: center; justify-content: center;
    background: transparent; border: none; color: #b0b0b0; border-radius: 4px;
  }
  .scrim { display: none; }

  /* Raised from 600px: eight nav items need roughly 880px. */
  @media (max-width: 900px) {
    .hamburger { display: flex; }
    .scrim {
      display: block; position: fixed; inset: var(--header-h) 0 0 0; z-index: 1;
      padding: 0; border: 0; border-radius: 0; background: rgba(0, 0, 0, 0.55);
    }
    nav {
      display: none; position: absolute; z-index: 2; top: 100%; left: 0; right: 0;
      flex-direction: column; align-items: stretch; height: auto;
      max-height: calc(100dvh - var(--header-h)); overflow-y: auto;
      background: #1f1d19; border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
    }
    nav.open { display: flex; }
    .nav-item {
      height: auto; min-height: 48px; padding: 0 1.25rem; justify-content: flex-start;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04); font-size: 0.9rem;
    }
  }
</style>