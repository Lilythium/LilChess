<script lang="ts">
  import type { Color, GameState } from "@lilchess/shared";
  import { abortWarning } from "../game/abortWarning";

  let { game, myColor, offset }: { game: GameState; myColor: Color | null; offset: number } = $props();

  let now = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 250);
    return () => clearInterval(t);
  });

  const warning = $derived(abortWarning(game, myColor, now + offset));
</script>

{#if warning}
  <p class="warn" class:urgent={warning.urgent}>{warning.text}</p>
{/if}

<style>
  .warn {
    margin: 0;
    padding: 0.5rem 0.75rem;
    background: var(--panel-hi);
    border-left: 3px solid var(--blue);
    border-radius: var(--radius);
    color: var(--text-hi);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.45);
  }
  .urgent { border-left-color: var(--red); }
</style>