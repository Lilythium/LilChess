<script lang="ts">
  import { canOfferTakeback, type Color, type GameState } from "@lilchess/shared";
  import { api } from "../api";

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
      await api(`/api/games/${id}/${path}`, { method: "POST" });
    } catch {
      // server state wins; resync below
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

  const opponentOffered = $derived(game.drawOfferedBy !== undefined && game.drawOfferedBy !== myColor);
  const iOffered = $derived(game.drawOfferedBy !== undefined && game.drawOfferedBy === myColor);
  const opponentAskedTakeback = $derived(game.takebackOfferedBy !== undefined && game.takebackOfferedBy !== myColor);
  const iAskedTakeback = $derived(game.takebackOfferedBy !== undefined && game.takebackOfferedBy === myColor);
  const takebackAllowed = $derived(myColor !== null && canOfferTakeback(game, myColor));
</script>

{#if myColor && game.status === "started"}
  <div class="row">
    {#if opponentOffered}
      <span class="muted">Opponent offers a draw</span>
      <button class="primary" disabled={busy} onclick={() => act("draw/accept")}>Accept</button>
      <button disabled={busy} onclick={() => act("draw/decline")}>Decline</button>
    {:else if iOffered}
      <span class="muted">Draw offered</span>
    {:else}
      <button disabled={busy} onclick={() => act("draw/offer")}>Offer draw</button>
    {/if}

    {#if opponentAskedTakeback}
      <span class="muted">Opponent asks to take back a move</span>
      <button class="primary" disabled={busy} onclick={() => act("takeback/accept")}>Allow</button>
      <button disabled={busy} onclick={() => act("takeback/decline")}>Decline</button>
    {:else if iAskedTakeback}
      <span class="muted">Takeback requested</span>
    {:else if takebackAllowed}
      <button disabled={busy} onclick={() => act("takeback/offer")}>Takeback</button>
    {/if}

    {#if game.ply <= 1}
      <button disabled={busy} onclick={() => act("abort")}>Abort</button>
    {/if}

    <button class="danger" disabled={busy} onclick={resign}>
      {confirmResign ? "Really resign?" : "Resign"}
    </button>
  </div>
{/if}