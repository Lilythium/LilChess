<script lang="ts">
  import { onDestroy } from "svelte";
  import { Chessground } from "chessground";
  import type { Api } from "chessground/api";
  import type { Config } from "chessground/config";
  import type { Key } from "chessground/types";

  let { fen, lastMove = null, orientation = "white" }: {
    fen: string;
    lastMove?: string | null;
    orientation?: "white" | "black";
  } = $props();

  let el: HTMLDivElement;
  let cg: Api | undefined;

  $effect(() => {
    const config: Config = {
      fen,
      orientation,
      lastMove: lastMove ? [lastMove.slice(0, 2) as Key, lastMove.slice(2, 4) as Key] : undefined,
    };
    if (cg) {
      cg.set(config);
    } else {
      cg = Chessground(el, {
        ...config,
        viewOnly: true,
        coordinates: false,
        animation: { enabled: false },
        drawable: { enabled: false },
        highlight: { lastMove: true, check: true },
      });
    }
  });

  onDestroy(() => cg?.destroy());
</script>

<div class="mini" bind:this={el}></div>

<style>
  /* pointer-events none lets clicks fall through to the surrounding link */
  .mini { width: 100%; aspect-ratio: 1; pointer-events: none; }
</style>