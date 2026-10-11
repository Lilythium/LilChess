<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";

  type Tab = "overview" | "users" | "tournaments" | "invitations" | "games" | "audit";
  type UserRow = {
    id: number; username: string; createdAt: number; isAdmin: number; isGuest: number;
    email: string | null; activeSessions: number; gameCount: number;
  };
  type TournamentRow = {
    id: string; name: string; status: string; format: string; mode: string; createdAt: number;
    creator: string; participants: number; games: number;
  };
  type InvitationRow = {
    id: string; mode: string; createdAt: number; expiresAt: number; isLink: number;
    fromUser: string; toUser: string | null;
  };
  type GameRow = {
    id: string; status: string; result: string | null; termination: string | null; mode: string;
    ply: number; createdAt: number; endedAt: number | null; white: string; black: string;
  };
  type AuditRow = { id: number; action: string; target: string; details: string; createdAt: number; actor: string };
  type Stats = {
    users: number; registeredUsers: number; guests: number; activeGames: number; completedGames: number;
    openInvitations: number; openTournaments: number; runningTournaments: number;
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: "Overview" }, { id: "users", label: "Users" },
    { id: "tournaments", label: "Tournaments" }, { id: "invitations", label: "Invitations" },
    { id: "games", label: "Games" }, { id: "audit", label: "Audit log" },
  ];

  let activeTab = $state<Tab>("overview");
  let showGuests = $state(false);
  let stats = $state<Stats | null>(null);
  let users = $state<UserRow[]>([]);
  let tournaments = $state<TournamentRow[]>([]);
  let invitations = $state<InvitationRow[]>([]);
  let games = $state<GameRow[]>([]);
  let audit = $state<AuditRow[]>([]);
  let loading = $state(true);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let notice = $state<string | null>(null);

  const visibleUsers = $derived(showGuests ? users : users.filter((user) => !user.isGuest));
  const hiddenGuestCount = $derived(users.length - visibleUsers.length);

  async function refresh() {
    loading = true;
    try {
      const [s, u, t, i, g, a] = await Promise.all([
        api<{ stats: Stats }>("/api/admin/stats"),
        api<{ users: UserRow[] }>("/api/admin/users"),
        api<{ tournaments: TournamentRow[] }>("/api/admin/tournaments"),
        api<{ invitations: InvitationRow[] }>("/api/admin/invitations"),
        api<{ games: GameRow[] }>("/api/admin/games"),
        api<{ entries: AuditRow[] }>("/api/admin/audit"),
      ]);
      stats = s.stats;
      users = u.users;
      tournaments = t.tournaments;
      invitations = i.invitations;
      games = g.games;
      audit = a.entries;
      error = null;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  onMount(() => { void refresh(); });

  async function act(operation: () => Promise<unknown>) {
    if (busy) return;
    busy = true;
    error = null;
    notice = null;
    try {
      await operation();
      await refresh();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  function purgeGuests() {
    if (!confirm("Purge unused guest accounts? Guests with a session, invitation, or any game history are retained.")) return;
    void act(async () => {
      const result = await api<{ deleted: number }>("/api/admin/users/purge-guests", { method: "POST" });
      notice = `Purged ${result.deleted} unused guest account${result.deleted === 1 ? "" : "s"}.`;
    });
  }

  function changeRole(user: UserRow) {
    const isAdmin = !user.isAdmin;
    if (!confirm(`${isAdmin ? "Grant" : "Remove"} administrator access for ${user.username}?`)) return;
    void act(() => api(`/api/admin/users/${user.id}`, { method: "PATCH", body: { isAdmin } }));
  }

  function revokeSessions(user: UserRow) {
    if (!confirm(`Revoke all active sessions for ${user.username}?`)) return;
    void act(() => api(`/api/admin/users/${user.id}/revoke-sessions`, { method: "POST" }));
  }

  function removeInvitation(invite: InvitationRow) {
    if (!confirm(`Revoke invitation ${invite.id}?`)) return;
    void act(() => api(`/api/admin/invitations/${invite.id}`, { method: "DELETE" }));
  }

  function tournamentAction(tournament: TournamentRow, action: "start" | "cancel") {
    const verb = action === "start" ? "Start" : "Cancel";
    if (!confirm(`${verb} ${tournament.name}?`)) return;
    void act(() => api(`/api/admin/tournaments/${tournament.id}/${action}`, { method: "POST" }));
  }

  function terminate(game: GameRow) {
    if (!confirm(`Terminate game ${game.id} between ${game.white} and ${game.black}?`)) return;
    void act(() => api(`/api/admin/games/${game.id}/terminate`, { method: "POST" }));
  }

  const date = (value: number | null) => value ? new Date(value).toLocaleString() : "—";
</script>

<svelte:head><title>Administration | LilChess</title></svelte:head>

<section class="admin">
  <header class="heading">
    <div><p class="eyebrow">SERVER CONTROL</p><h1>Administration</h1></div>
    <button class="refresh" onclick={() => void refresh()} disabled={loading} aria-label="Refresh admin data" title="Refresh">↻</button>
  </header>

  <nav class="tabs" aria-label="Administration sections">
    {#each tabs as tab}
      <button class:active={activeTab === tab.id} aria-pressed={activeTab === tab.id} onclick={() => (activeTab = tab.id)}>{tab.label}</button>
    {/each}
  </nav>

  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if notice}<p class="notice" role="status">{notice}</p>{/if}
  {#if loading}<p class="muted">Loading server data…</p>{:else}
    {#if activeTab === "overview" && stats}
      <div class="stats" aria-label="Server statistics">
        <div><span>Accounts</span><strong>{stats.users}</strong><small>{stats.registeredUsers} registered · {stats.guests} guests</small></div>
        <div><span>Games in progress</span><strong>{stats.activeGames}</strong><small>{stats.completedGames} completed or aborted</small></div>
        <div><span>Invitations</span><strong>{stats.openInvitations}</strong><small>currently open</small></div>
        <div><span>Tournaments</span><strong>{stats.openTournaments + stats.runningTournaments}</strong><small>{stats.openTournaments} open · {stats.runningTournaments} running</small></div>
      </div>
      <p class="muted overview-note">Administrative page access and actions are recorded in the audit log.</p>
    {:else if activeTab === "users"}
      <div class="user-tools">
        <label class="guest-toggle"><input type="checkbox" bind:checked={showGuests} /> Show guest accounts <span>{hiddenGuestCount} hidden</span></label>
        <button class="danger" disabled={busy} onclick={purgeGuests}>Purge unused guests</button>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>User</th><th>Type</th><th>Joined</th><th>Sessions</th><th>Games</th><th>Access</th><th>Actions</th></tr></thead>
        <tbody>{#each visibleUsers as user (user.id)}
          <tr>
            <td><strong>{user.username}</strong>{#if user.email}<small>{user.email}</small>{/if}</td>
            <td>{user.isGuest ? "Guest" : "Registered"}</td><td>{date(user.createdAt)}</td>
            <td>{user.activeSessions}</td><td>{user.gameCount}</td><td>{user.isAdmin ? "Admin" : "User"}</td>
            <td class="actions">
              <button disabled={busy || (Boolean(user.isGuest) && !user.isAdmin)} onclick={() => changeRole(user)}>{user.isAdmin ? "Remove admin" : "Make admin"}</button>
              <button disabled={busy || user.activeSessions === 0} onclick={() => revokeSessions(user)}>Revoke sessions</button>
            </td>
          </tr>
        {/each}</tbody>
      </table></div>
    {:else if activeTab === "tournaments"}
      <div class="table-wrap"><table>
        <thead><tr><th>Tournament</th><th>Organizer</th><th>Status</th><th>Format</th><th>Players</th><th>Games</th><th>Actions</th></tr></thead>
        <tbody>{#each tournaments as tournament (tournament.id)}
          <tr>
            <td><a href={`#/tournament/${tournament.id}`}>{tournament.name}</a><small>{tournament.id}</small></td>
            <td>{tournament.creator}</td><td><span class="status">{tournament.status}</span></td>
            <td>{tournament.format.replaceAll("_", " ")} · {tournament.mode}</td><td>{tournament.participants}</td><td>{tournament.games}</td>
            <td class="actions">
              {#if tournament.status === "open"}<button disabled={busy} onclick={() => tournamentAction(tournament, "start")}>Start</button><button class="danger" disabled={busy} onclick={() => tournamentAction(tournament, "cancel")}>Cancel</button>{:else}—{/if}
            </td>
          </tr>
        {/each}</tbody>
      </table></div>
    {:else if activeTab === "invitations"}
      <div class="table-wrap"><table>
        <thead><tr><th>From</th><th>To</th><th>Type</th><th>Mode</th><th>Created</th><th>Expires</th><th></th></tr></thead>
        <tbody>{#each invitations as invite (invite.id)}
          <tr>
            <td>{invite.fromUser}</td><td>{invite.toUser ?? "Open"}</td><td>{invite.isLink ? "Link" : "Challenge"}</td>
            <td>{invite.mode}</td><td>{date(invite.createdAt)}</td><td>{date(invite.expiresAt)}</td>
            <td><button class="danger" disabled={busy} onclick={() => removeInvitation(invite)}>Revoke</button></td>
          </tr>
        {/each}</tbody>
      </table></div>
    {:else if activeTab === "games"}
      <div class="table-wrap"><table>
        <thead><tr><th>Game</th><th>Players</th><th>Status</th><th>Mode</th><th>Ply</th><th>Result</th><th>Started</th><th></th></tr></thead>
        <tbody>{#each games as game (game.id)}
          <tr>
            <td><a href={`#/game/${game.id}`}>{game.id}</a></td><td>{game.white} – {game.black}</td>
            <td><span class="status">{game.status}</span></td><td>{game.mode}</td><td>{game.ply}</td>
            <td>{game.result ?? game.termination ?? "—"}</td><td>{date(game.createdAt)}</td>
            <td>{#if game.status === "started"}<button class="danger" disabled={busy} onclick={() => terminate(game)}>Terminate</button>{/if}</td>
          </tr>
        {/each}</tbody>
      </table></div>
    {:else}
      <div class="table-wrap"><table>
        <thead><tr><th>Time</th><th>Administrator</th><th>Action</th><th>Target</th><th>Result</th></tr></thead>
        <tbody>{#each audit as entry (entry.id)}
          <tr><td>{date(entry.createdAt)}</td><td>{entry.actor}</td><td>{entry.action}</td><td>{entry.target}</td>
            <td>{JSON.parse(entry.details).statusCode ?? "—"}</td></tr>
        {/each}</tbody>
      </table></div>
    {/if}
    {#if activeTab !== "overview" && ((activeTab === "users" && visibleUsers.length === 0) || (activeTab === "tournaments" && tournaments.length === 0) || (activeTab === "invitations" && invitations.length === 0) || (activeTab === "games" && games.length === 0) || (activeTab === "audit" && audit.length === 0))}
      <p class="empty">Nothing to show.</p>
    {/if}
  {/if}
</section>

<style>
  .admin { min-width: 0; }
  .heading { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem; }
  .heading h1 { margin: 0; }
  .eyebrow { margin: 0 0 .25rem; color: var(--muted); font-size: .75rem; font-weight: 700; letter-spacing: .08em; }
  .refresh { width: 42px; height: 42px; padding: 0; font-size: 1.4rem; }
  .tabs { display: flex; gap: .35rem; overflow-x: auto; border-bottom: 1px solid var(--border); margin-bottom: 1.25rem; }
  .tabs button { flex: 0 0 auto; background: transparent; color: var(--muted); border: 0; border-radius: 0; border-bottom: 2px solid transparent; }
  .tabs button.active { color: var(--text-hi); border-bottom-color: var(--green-hi); }
  .stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border-block: 1px solid var(--border); }
  .stats > div { display: flex; flex-direction: column; padding: 1.1rem; border-right: 1px solid var(--border); }
  .stats > div:last-child { border-right: 0; }
  .stats span { color: var(--muted); font-size: .85rem; }
  .stats strong { color: var(--text-hi); font-size: 1.8rem; font-variant-numeric: tabular-nums; }
  .stats small, td small { display: block; color: var(--muted); font-size: .78rem; }
  .overview-note { margin-top: 1rem; }
  .notice { color: var(--green-hi); }
  .user-tools { display: flex; align-items: center; justify-content: space-between; gap: .75rem; flex-wrap: wrap; margin-bottom: .75rem; }
  .guest-toggle { display: inline-flex; align-items: center; gap: .55rem; color: var(--text-hi); }
  .guest-toggle input { accent-color: var(--green-hi); }
  .guest-toggle span { color: var(--muted); font-size: .82rem; }
  .table-wrap { width: 100%; overflow-x: auto; }
  table { min-width: 760px; }
  th { color: var(--muted); font-size: .78rem; font-weight: 600; white-space: nowrap; }
  td { vertical-align: middle; }
  td strong { color: var(--text-hi); }
  .actions { white-space: nowrap; }
  .actions button { margin: .15rem; font-size: .82rem; }
  button.danger { color: #f08b81; border: 1px solid var(--border); }
  .status { color: var(--text-hi); text-transform: capitalize; }
  .empty { padding: 2rem 0; color: var(--muted); }
  @media (max-width: 700px) {
    .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .stats > div:nth-child(2) { border-right: 0; }
    .stats > div:nth-child(-n+2) { border-bottom: 1px solid var(--border); }
    .tabs { margin-inline: -1rem; padding-inline: 1rem; }
  }
</style>