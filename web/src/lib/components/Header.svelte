<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../api";
  import { auth, logout } from "../auth.svelte";
  import type { MyGames } from "../types";
  import { displayName } from "../format";

  let yourTurn = $state(0);
  let menuOpen = $state(false);

  async function poll() {
    try {
      const g = await api<MyGames>("/api/games/my-games");
      yourTurn = g.myTurn.length;
    } catch { }
  }

  onMount(() => {
    void poll();
    const t = setInterval(poll, 10_000);
    return () => clearInterval(t);
  });

  $effect(() => {
    document.title = yourTurn > 0 ? `(${yourTurn}) LilChess` : "LilChess";
  });

  const profileHref = $derived("#/u/" + encodeURIComponent(auth.user?.username ?? ""));

  function toggleMenu() {
    menuOpen = !menuOpen;
  }

  function closeMenu() {
    menuOpen = false;
  }

  function onLogout() {
    closeMenu();
    if (auth.user?.is_guest && !confirm("Guest accounts can't be recovered after logging out. Log out anyway?")) return;
    void logout();
  }
</script>

<header>
  <a class="logo" href="#/" onclick={closeMenu}>LilChess</a>

  <button 
    class="hamburger" 
    onclick={toggleMenu} 
    aria-label="Toggle navigation menu"
    aria-expanded={menuOpen}
  >
    <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
      {#if menuOpen}
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      {:else}
        <line x1="3" y1="12" x2="21" y2="12"></line>
        <line x1="3" y1="6" x2="21" y2="6"></line>
        <line x1="3" y1="18" x2="21" y2="18"></line>
      {/if}
    </svg>
  </button>

  <nav class:open={menuOpen}>
    <a href="#/" class="nav-item" onclick={closeMenu}>PLAY</a>
    <a href="#/games" class="nav-item" onclick={closeMenu}>
      MY GAMES{#if yourTurn > 0} <span class="badge">{yourTurn}</span>{/if}
    </a>
    <a href="#/watch" class="nav-item" onclick={closeMenu}>WATCH</a>
    <a href={profileHref} class="nav-item" onclick={closeMenu}>{displayName(auth.user?.username ?? "").toUpperCase()}</a>
    <button class="nav-item btn-logout" onclick={onLogout}>LOG OUT</button>
  </nav>
</header>

<style>
  header { 
    position: relative;
    display: flex; 
    justify-content: space-between; 
    align-items: center;
    height: 48px; 
    padding: 0 1rem; 
    background: linear-gradient(to bottom, #2e2b26, #1f1d19);
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.3);
    z-index: 100;
  }

  .logo { 
    color: #bababa; 
    font-weight: bold; 
    font-size: 1.25rem; 
    text-decoration: none; 
    display: flex;
    align-items: center;
  }
  .logo:hover {
    color: #ffffff;
  }

  nav { 
    display: flex; 
    align-items: center; 
    height: 100%;
  }

  /* Lichess style nav buttons */
  .nav-item {
    display: flex;
    align-items: center;
    height: 100%;
    padding: 0 0.85rem;
    color: #b0b0b0;
    font-size: 0.85rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-decoration: none;
    background: transparent;
    border: none;
    cursor: pointer;
    transition: background-color 0.15s ease, color 0.15s ease;
  }

  .nav-item:hover {
    background-color: rgba(255, 255, 255, 0.12);
    color: #ffffff;
  }

  .btn-logout {
    font-family: inherit;
  }

  .badge { 
    background: #629924; 
    color: #fff; 
    border-radius: 10px; 
    padding: 0 0.4rem; 
    font-size: 0.75rem; 
    margin-left: 0.4rem;
  }

  .hamburger {
    display: none;
    background: transparent;
    border: none;
    color: #b0b0b0;
    padding: 0.4rem;
    cursor: pointer;
    border-radius: 4px;
  }
  .hamburger:hover {
    color: #ffffff;
    background-color: rgba(255, 255, 255, 0.12);
  }

  /* Mobile / Small Screens */
  @media (max-width: 600px) { 
    .hamburger {
      display: flex;
      align-items: center;
      justify-content: center;
    }

    nav {
      display: none;
      position: absolute;
      top: 48px;
      left: 0;
      right: 0;
      flex-direction: column;
      align-items: stretch;
      height: auto;
      background: #1f1d19;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
    }

    nav.open {
      display: flex;
    }

    .nav-item {
      height: 44px;
      padding: 0 1.25rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      justify-content: font-start;
      font-size: 0.9rem;
    }
  }
</style>