<script lang="ts">
  import { canOfferTakeback, type Color, type GameState } from "@lilchess/shared";
  import { postGameAction } from "../game/gameAction";

  let { game, myColor, id, onDone }: {
    game: GameState;
    myColor: Color | null;
    id: string;
    onDone: () => Promise<void>;
  } = $props();

  let confirmResign = $state(false);
  let busy = $state(false);

  async function act(path: string) {
    busy = true;
    try {
      await postGameAction(id, path);
    } finally {
      busy = false;
      confirmResign = false;
      await onDone();
    }
  }

  function resign() {
    if (confirmResign) void act("resign");
    else confirmResign = true;
  }

  const drawPending = $derived(game.drawOfferedBy !== undefined);
  const takebackAllowed = $derived(myColor !== null && canOfferTakeback(game, myColor));
</script>

{#if myColor && game.status === "started"}
  <div class="bar">
    <button title="Offer draw" aria-label="Offer draw"
            disabled={busy || drawPending} onclick={() => act("draw/offer")}>½</button>

    <button title="Ask for takeback" aria-label="Ask for takeback"
            disabled={busy || !takebackAllowed} onclick={() => act("takeback/offer")}>↶</button>

    {#if game.ply <= 1}
      <button title="Abort game" aria-label="Abort game"
              disabled={busy} onclick={() => act("abort")}>✕</button>
    {/if}

    <button class="danger" title="Resign" aria-label="Resign"
            disabled={busy} onclick={resign}>{confirmResign ? "Sure?" : "⚑"}</button>
  </div>
{/if}

<style>
  .bar {
    display: flex;
    background: var(--panel-hi);
    border-top: 1px solid var(--border);
  }
  .bar button {
    flex: 1;
    padding: 0.55rem 0;
    background: transparent;
    border-radius: 0;
    font-size: 1.1rem;
    line-height: 1.2;
  }
  .bar button:hover:not(:disabled) { background: #3a3835; }
  .bar button.danger:hover:not(:disabled) { background: var(--red); }
</style>