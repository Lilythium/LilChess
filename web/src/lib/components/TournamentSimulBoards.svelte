<script lang="ts">
  import { displayName } from "../format";

  type Board = {
    challengerId: number;
    challengerName: string;
    gameId: string;
    seat: number;
    hostColor: "white" | "black";
    status: string;
    result: string | null;
  };
  type Simul = {
    hostId: number;
    hostName: string;
    boards: Board[];
  };

  let { simuls, viewerId }: { simuls: Simul[]; viewerId: number | null } = $props();
  const statusText = (board: Board) =>
    board.status === "started" ? "Play" : board.result ?? board.status;
</script>

<section class="simul-section">
  <div class="section-title">
    <h2>Simul boards</h2>
    <span>{simuls.reduce((count, simul) => count + simul.boards.length, 0) / 2} unique games</span>
  </div>
  {#each simuls as simul (simul.hostId)}
    <section class:mine={simul.hostId === viewerId} class="host-simul">
      <h3>{displayName(simul.hostName)}'s simul</h3>
      <p class="muted">{simul.boards.filter((board) => board.status !== "started").length} / {simul.boards.length} boards completed</p>
      {#if simul.boards.length}
        <div class="board-list">
          {#each simul.boards as board (board.challengerId)}
            <a class="board-row" href={`#/game/${board.gameId}`}>
              <span class="seat">Board {board.seat}</span>
              <span class="opponent">{displayName(board.challengerName)}</span>
              <span class="color">{simul.hostId === viewerId ? `You play ${board.hostColor}` : board.hostColor}</span>
              <strong class:active={board.status === "started"}>{statusText(board)}</strong>
            </a>
          {/each}
        </div>
      {:else}
        <p class="muted">No boards.</p>
      {/if}
    </section>
  {/each}
</section>

<style>
  .simul-section { padding-top: 1.3rem; }
  .section-title { display:flex; justify-content:space-between; align-items:baseline; margin-bottom:.65rem; }
  h2 { margin:0; font-size:1.05rem; }
  h3 { margin:0 0 .25rem; font-size:.95rem; }
  .section-title span, .muted { color:var(--muted); font-size:.85rem; }
  .host-simul { padding:.75rem; margin-bottom:.75rem; border:1px solid var(--border); border-radius:4px; }
  .host-simul.mine { border-color:var(--text-hi); }
  .muted { margin:.2rem 0 .55rem; }
  .board-list { border-top:1px solid var(--border); }
  .board-row { display:grid; grid-template-columns:5rem minmax(0,1fr) 7rem auto; gap:.6rem; align-items:center; padding:.55rem .2rem; border-bottom:1px solid var(--border); color:var(--text-hi); text-decoration:none; font-size:.88rem; }
  .board-row:last-child { border-bottom:0; }
  .board-row:hover { background:rgba(255,255,255,.035); }
  .seat, .color { color:var(--muted); font-size:.78rem; }
  .opponent { overflow-wrap:anywhere; }
  strong { color:var(--muted); font-size:.8rem; font-weight:500; text-align:right; text-transform:capitalize; }
  strong.active { color:#a4ca80; }
  @media(max-width:600px) { .board-row { grid-template-columns:4rem minmax(0,1fr) auto; } .color { display:none; } }
</style>
