<script lang="ts">
  import { onMount } from "svelte";
  import { auth, loadMe } from "./lib/auth.svelte";
  import { route, matchRoute, navigate } from "./lib/router.svelte";
  import Header from "./lib/components/Header.svelte";
  import Login from "./routes/Login.svelte";
  import Lobby from "./routes/Lobby.svelte";
  import Game from "./routes/Game.svelte";
  import MyGames from "./routes/MyGames.svelte";
  import Profile from "./routes/Profile.svelte";

  onMount(loadMe);

  $effect(() => {
    if (!auth.ready) return;
    if (!auth.user && route.path !== "/login") navigate("/login");
    if (auth.user && route.path === "/login") navigate("/");
  });

  const game = $derived(matchRoute(route.path, "/game/:id"));
  const profile = $derived(matchRoute(route.path, "/u/:name"));
</script>

{#if !auth.ready}
  <p class="page muted">Loading…</p>
{:else if !auth.user}
  <Login />
{:else}
  <Header />
  <main class="page">
    {#if game}{#key game.id}<Game id={game.id} />{/key}
    {:else if profile}{#key profile.name}<Profile name={profile.name} />{/key}
    {:else if route.path === "/games"}<MyGames />
    {:else}<Lobby />{/if}
  </main>
{/if}