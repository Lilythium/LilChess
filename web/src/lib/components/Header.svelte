<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../api";
  import { auth, logout } from "../auth.svelte";
  import type { MyGames } from "../types";

  let yourTurn = $state(0);

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
</script>

<header>
  <a class="logo" href="#/">LilChess</a>
  <nav>
    <a href="#/">Lobby</a>
    <a href="#/games">My games{#if yourTurn > 0} <span class="badge">{yourTurn}</span>{/if}</a>
    <a href={profileHref}>{auth.user?.username}</a>
    <button onclick={() => logout()}>Log out</button>
  </nav>
</header>

<style>
  header { display: flex; justify-content: space-between; align-items: center;
           height: 48px; padding: 0 1rem; background: var(--panel); }
  .logo { color: var(--text-hi); font-weight: 700; font-size: 1.2rem; }
  nav { display: flex; align-items: center; gap: 1rem; }
  nav button { padding: 0.3rem 0.7rem; background: transparent; color: var(--muted); }
  .badge { background: var(--green); color: #fff; border-radius: 10px; padding: 0 0.4rem; font-size: 0.8rem; }
  @media (max-width: 600px) { nav { gap: 0.6rem; font-size: 0.9rem; } }
</style>