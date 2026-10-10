<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "./lib/api";
  import { auth, loadMe } from "./lib/auth.svelte";
  import { route, matchRoute, navigate } from "./lib/router.svelte";
  import type { MyGames as MyGamesData } from "./lib/types";
  import Header from "./lib/components/Header.svelte";
  import Login from "./routes/Login.svelte";
  import Lobby from "./routes/Lobby.svelte";
  import Game from "./routes/Game.svelte";
  import LocalGame from "./routes/LocalGame.svelte";
  import MyGames from "./routes/MyGames.svelte";
  import Profile from "./routes/Profile.svelte";
  import Watch from "./routes/Watch.svelte";
  import Invite from "./routes/Invite.svelte";
  import Settings from "./routes/Settings.svelte";
  import Forgot from "./routes/Forgot.svelte";
  import ResetPassword from "./routes/ResetPassword.svelte";
  import Unsubscribe from "./routes/Unsubscribe.svelte";
  import Tournaments from "./routes/Tournaments.svelte";
  import TournamentDetail from "./routes/TournamentDetail.svelte";
  import Leaderboard from "./routes/Leaderboard.svelte";  
  import { connectUserSocket } from "./lib/ws/userSocket";

  onMount(loadMe);

  const game = $derived(matchRoute(route.path, "/game/:id"));
  const profile = $derived(matchRoute(route.path, "/u/:name"));
  const invite = $derived(matchRoute(route.path, "/c/:id"));
  const reset = $derived(matchRoute(route.path, "/reset/:token"));
  const unsub = $derived(matchRoute(route.path, "/unsubscribe/:token"));
  const tournament = $derived(matchRoute(route.path, "/tournament/:id"));
  const leaderboard = $derived(matchRoute(route.path, "/leaderboard/:variant"));
  const forgot = $derived(route.path === "/forgot");
  // Reachable without logging in (the user is locked out, or clicked a link in an email).
  const publicPage = $derived(forgot || !!reset || !!unsub);

  $effect(() => {
    if (!auth.ready) return;
    // Invite links are reachable while logged out: the page offers login / register / guest.
    if (!auth.user && route.path !== "/login" && !invite && !publicPage) navigate("/login");
    if (auth.user && route.path === "/login") navigate("/");
  });

  // On startup/login, resume the active game that will end soonest (else stay on the lobby).
  let resumeDone = $state(false);
  let resumedFor: number | null = null;

  async function resume() {
    const atHome = () => route.path === "/" || route.path === "/login";
    if (!atHome()) return; // deep links (#/games, #/u/bob, #/game/x, #/c/x) are left alone
    try {
      const g = await api<MyGamesData>("/api/games/my-games");
      if (!atHome()) return;
      const active = [...g.myTurn, ...g.theirTurn].sort((a, b) => a.deadline_at - b.deadline_at);
      if (active[0]) navigate(`/game/${active[0].id}`);
    } catch {
      // stay on the lobby
    }
  }

  $effect(() => {
    if (!auth.ready) return;
    const u = auth.user;
    if (!u) { resumedFor = null; return; }
    if (resumedFor === u.id) return;
    resumedFor = u.id;
    resumeDone = false;
    void resume().finally(() => (resumeDone = true));
  });

  // Tournament games open themselves: the server pushes "pairing_ready" when a live round starts.
  // The list is also checked on every (re)connect, because events sent while offline are lost.
  $effect(() => {
    if (!auth.ready || !auth.user) return;
    const opened = new Set<string>(); // game ids already auto-opened, so nothing opens twice
    let checking = false;
    function open(gameId: string) {
      if (opened.has(gameId)) return;
      opened.add(gameId);
      navigate(`/game/${gameId}`);
    }
    async function catchUp() {
      if (checking) return;
      checking = true;
      try {
        const result = await api<{ tournaments: {
          status: string; joined: number; nextGameId: string | null;
        }[] }>("/api/tournaments");
        const waiting = result.tournaments.find((item) => item.joined && item.status === "running" && item.nextGameId);
        if (waiting?.nextGameId) open(waiting.nextGameId);
      } catch {
        // transient; the next reconnect will check again
      } finally {
        checking = false;
      }
    }
    const socket = connectUserSocket({
      onEvent: (event) => { if (event.type === "pairing_ready") open(event.gameId); },
      onOpen: () => void catchUp(),
    });
    return () => socket.close();
  });
</script>

{#snippet publicPages()}
  {#if forgot}<Forgot />
  {:else if reset}{#key reset.token}<ResetPassword token={reset.token} />{/key}
  {:else if unsub}{#key unsub.token}<Unsubscribe token={unsub.token} />{/key}{/if}
{/snippet}

{#if !auth.ready || (auth.user && !resumeDone)}
  <p class="page muted">Loading…</p>
{:else if !auth.user}
  {#if invite}
    <main class="page">{#key invite.id}<Invite id={invite.id} />{/key}</main>
  {:else if publicPage}
    <main class="page">{@render publicPages()}</main>
  {:else}
    <main class="page"><Login /></main>
  {/if}
{:else}
  <Header />
  <main class="page">
    {#if game}{#key game.id}<Game id={game.id} />{/key}
    {:else if invite}{#key invite.id}<Invite id={invite.id} />{/key}
    {:else if profile}{#key profile.name}<Profile name={profile.name} />{/key}
    {:else if publicPage}{@render publicPages()}
    {:else if route.path === "/games"}<MyGames />
    {:else if route.path === "/settings"}<Settings />
    {:else if route.path === "/local"}<LocalGame />
    {:else if route.path === "/watch"}<Watch />
    {:else if route.path === "/tournaments"}<Tournaments />
    {:else if route.path === "/leaderboard"}<Leaderboard /> 
    {:else if leaderboard}<Leaderboard variant={leaderboard.variant} />  
    {:else if tournament}{#key tournament.id}<TournamentDetail id={tournament.id} />{/key}
    {:else}<Lobby />{/if}
  </main>
{/if}