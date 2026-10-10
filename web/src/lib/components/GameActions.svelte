<script lang="ts">
  import { onDestroy } from "svelte";
  import { canOfferTakeback, type Color, type GameState } from "@lilchess/shared";
  import { postGameAction } from "../game/gameAction";

  let { game, myColor, id, onDone, noTakebacks = false }: {
    game: GameState;
    myColor: Color | null;
    id: string;
    onDone: () => Promise<void>;
    noTakebacks?: boolean;
  } = $props();

  let confirmResign = $state(false);
  let busy = $state(false);
  let confirmTimer: ReturnType<typeof setTimeout> | undefined;

  function clearConfirm() { clearTimeout(confirmTimer); confirmResign = false; }

  async function act(path: string) {
    busy = true;
    try {
      await postGameAction(id, path);
    } finally {
      busy = false;
      clearConfirm();
      await onDone();
    }
  }

  function resign() {
    if (confirmResign) { void act("resign"); return; }
    confirmResign = true;
    // A stray tap a minute later must not resign the game.
    confirmTimer = setTimeout(() => (confirmResign = false), 4000);
  }

  onDestroy(() => clearTimeout(confirmTimer));

  const drawPending = $derived(game.drawOfferedBy !== undefined);
  const takebackAllowed = $derived(myColor !== null && canOfferTakeback(game, myColor));
</script>

{#if myColor && game.status === "started"}
  <div class="bar">
    <button title="Offer draw" aria-label="Offer draw" disabled={busy || drawPending} onclick={() => act("draw/offer")}>
      <span class="ico">½</span><span class="lbl">Draw</span>
    </button>
    <button title={noTakebacks ? "Takebacks are off in simuls" : "Ask for takeback"} aria-label="Ask for takeback" disabled={busy || !takebackAllowed || noTakebacks} onclick={() => act("takeback/offer")}>
      <span class="ico">↶</span><span class="lbl">Takeback</span>
    </button>
    <!-- Always rendered so Resign never moves; the server only allows abort before move 2 anyway. -->
    <button title="Abort game" aria-label="Abort game" disabled={busy || game.ply > 1} onclick={() => act("abort")}>
      <span class="ico">✕</span><span class="lbl">Abort</span>
    </button>
    <button class="danger" title="Resign" aria-label="Resign" disabled={busy} onclick={resign}>
      <span class="ico">{confirmResign ? "?" : "⚑"}</span><span class="lbl">{confirmResign ? "Confirm" : "Resign"}</span>
    </button>
  </div>
{/if}

<style>
  .bar { display: flex; background: var(--panel-hi); border-top: 1px solid var(--border); }
  .bar button {
    flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.1rem;
    padding: 0.55rem 0; background: transparent; border-radius: 0; font-size: 1.1rem; line-height: 1.2;
  }
  .lbl { display: none; font-size: 0.7rem; color: var(--muted); }
  :global(.game-mobile) .lbl { display: block; }
  :global(.game-mobile) .bar button { min-height: 56px; }
  @media (hover: hover) {
    .bar button:hover:not(:disabled) { background: #3a3835; }
    .bar button.danger:hover:not(:disabled) { background: var(--red); }
  }
</style>