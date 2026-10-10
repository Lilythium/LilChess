<script lang="ts">
  import type { Color, GameState } from "@lilchess/shared";
  import Clock from "./Clock.svelte";

  let { color, name, rating = null, provisional = false, meta = "", game, offset, showClock = true }: {
    color: Color; name: string; rating?: number | null; provisional?: boolean; meta?: string;
    game: GameState; offset: number; showClock?: boolean;
  } = $props();

  const toMove = $derived(game.status === "started" && game.turn === color);
</script>

<div class="strip" class:to-move={toMove}>
  <span class="piece" aria-hidden="true">{color === "white" ? "⚪" : "⚫"}</span>
  <span class="who">
    <span class="line">
      <span class="name">{name}</span>
      {#if rating !== null}<span class="rating">({rating}{provisional ? "?" : ""})</span>{/if}
    </span>
    {#if meta}<span class="meta">{meta}</span>{/if}
  </span>
  {#if showClock}<span class="clock"><Clock {game} side={color} {offset} /></span>{/if}
</div>

<style>
  .strip {
    display: flex; align-items: center; gap: 0.5rem; height: var(--strip-h, 46px); padding: 0 0.75rem;
    background: var(--panel); color: var(--text-hi); border-left: 3px solid transparent;
  }
  .strip.to-move { border-left-color: var(--green); }
  .piece { flex: 0 0 1.1rem; text-align: center; }
  .who { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; line-height: 1.2; }
  .line { display: flex; align-items: baseline; gap: 0.35rem; min-width: 0; }
  .name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rating, .meta { color: var(--muted); font-size: 0.8rem; white-space: nowrap; }
  .meta { font-size: 0.72rem; }
  .clock { flex: 0 0 auto; margin-left: auto; }
</style>