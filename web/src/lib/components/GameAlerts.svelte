<script lang="ts">
  import type { Color, GameState } from "@lilchess/shared";
  import { postGameAction } from "../game/gameAction";
  import AbortWarning from "./AbortWarning.svelte";

  let { game, myColor, id, offset, onDone }: {
    game: GameState;
    myColor: Color | null;
    id: string;
    offset: number;
    onDone: () => Promise<void>;
  } = $props();

  let busy = $state(false);

  async function act(path: string) {
    busy = true;
    try {
      await postGameAction(id, path);
    } finally {
      busy = false;
      await onDone();
    }
  }

  const playing = $derived(myColor !== null && game.status === "started");
  const opponentDraw = $derived(game.drawOfferedBy !== undefined && game.drawOfferedBy !== myColor);
  const iOfferedDraw = $derived(game.drawOfferedBy !== undefined && game.drawOfferedBy === myColor);
  const opponentTakeback = $derived(game.takebackOfferedBy !== undefined && game.takebackOfferedBy !== myColor);
  const iAskedTakeback = $derived(game.takebackOfferedBy !== undefined && game.takebackOfferedBy === myColor);
</script>

<div class="alerts">
  <AbortWarning {game} {myColor} {offset} />

  {#if playing}
    {#if opponentDraw}
      <div class="alert">
        <span>Opponent offers a draw</span>
        <div class="row">
          <button class="primary" disabled={busy} onclick={() => act("draw/accept")}>Accept</button>
          <button disabled={busy} onclick={() => act("draw/decline")}>Decline</button>
        </div>
      </div>
    {:else if iOfferedDraw}
      <div class="alert"><span class="muted">Draw offered</span></div>
    {/if}

    {#if opponentTakeback}
      <div class="alert">
        <span>Opponent asks to take back a move</span>
        <div class="row">
          <button class="primary" disabled={busy} onclick={() => act("takeback/accept")}>Allow</button>
          <button disabled={busy} onclick={() => act("takeback/decline")}>Decline</button>
        </div>
      </div>
    {:else if iAskedTakeback}
      <div class="alert"><span class="muted">Takeback requested</span></div>
    {/if}
  {/if}
</div>

<style>
  /* Floats under the sidebar, hugging the board side. Empty = zero height. */
  .alerts {
    position: absolute;
    top: calc(100% + 0.5rem);
    left: 0;
    right: 0;
    z-index: 5;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .alert {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    background: var(--panel-hi);
    border-left: 3px solid var(--blue);
    border-radius: var(--radius);
    color: var(--text-hi);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.45);
  }

  /* On phones the sidebar is the last thing on the page, so let alerts flow normally. */
  @media (max-width: 800px) {
    .alerts { position: static; margin-top: 0.5rem; }
  }
</style>