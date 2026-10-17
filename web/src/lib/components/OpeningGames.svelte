<script lang="ts">
  import { displayName } from "../format";
  import GameHoverPreview from "./GameHoverPreview.svelte";

  let { games, total }: {
    games: {
      id: string;
      white_name: string;
      white_rating: number | null;
      black_name: string;
      black_rating: number | null;
      result: string;
      fen: string;
      last_move: string | null;
    }[];
    total: number;
  } = $props();
</script>

<section class="panel" aria-label="Games at this position">
  <h2>Games <span class="count">{total}</span></h2>
  {#if games.length === 0}
    <p class="muted">No finished games reached this position.</p>
  {:else}
    {#if total > games.length}<p class="muted showing">Showing the latest {games.length} of {total}</p>{/if}
    <div class="game-list">
      {#each games as game (game.id)}
        <GameHoverPreview fen={game.fen} lastMove={game.last_move}>
          <a class="opening-game-link" href={`#/game/${game.id}`}>
              <span class="players">
                <span class="player">{displayName(game.white_name)} <span class="rating">({game.white_rating ?? "—"})</span></span>
                <span class="versus"> vs </span>
                <span class="player">{displayName(game.black_name)} <span class="rating">({game.black_rating ?? "—"})</span></span>
              </span>
            <span class="result">{game.result}</span>
          </a>
        </GameHoverPreview>
      {/each}
    </div>
  {/if}
</section>

<style>
  h2 { display: flex; align-items: baseline; gap: 0.5rem; margin-bottom: 0.5rem; }
  .count, .rating { color: var(--muted); font-size: 0.85rem; font-weight: 400; }
  .showing { margin: 0 0 0.4rem; font-size: 0.85rem; }
  .game-list { max-height: 13.5rem; overflow-y: auto; border-top: 1px solid var(--border); }
  .opening-game-link {
    display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0.4rem; align-items: center;
    padding: 0.55rem 0.25rem; border-bottom: 1px solid var(--border); color: var(--text);
  }
  .players { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.35; }
  .player { min-width: 0; }
  .versus { color: var(--muted); font-size: 0.8rem; }
  .result { color: var(--text-hi); font-weight: 600; white-space: nowrap; }
  @media (hover: hover) {
    .opening-game-link:hover { background: var(--panel-hi); color: var(--text-hi); text-decoration: none; }
  }
</style>