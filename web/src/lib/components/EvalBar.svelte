<script lang="ts">
  import { formatScore, winPercent, type Color, type Score } from "@lilchess/shared";

  let { score, orientation = "white" }: { score?: Score; orientation?: Color } = $props();

  const whitePct = $derived(score ? winPercent(score) : 50);
  const label = $derived(score ? formatScore(score) : "");
  const whiteAtBottom = $derived(orientation === "white");
  // The label sits inside whichever side is ahead, so it stays readable.
  const labelAtBottom = $derived(whiteAtBottom ? whitePct >= 50 : whitePct < 50);
</script>

<div
  class="bar"
  class:flip={!whiteAtBottom}
  role="img"
  aria-label={score ? `Evaluation ${label}` : "No evaluation yet"}
>
  <div class="white" style:height="{whitePct}%"></div>
  {#if label}
    <span class="label" class:bottom={labelAtBottom} class:on-white={whitePct >= 50}>{label}</span>
  {/if}
</div>

<style>
  .bar {
    position: relative; display: flex; flex-direction: column-reverse;
    container-type: inline-size;
    width: 100%; height: 100%; background: #403d39; border-radius: 3px; overflow: hidden;
  }
  .bar.flip { flex-direction: column; }
  .white { background: #f0f0f0; transition: height 0.3s ease; }
  .label {
    position: absolute; left: 1px; right: 1px; top: 2px; overflow: hidden;
    text-align: center; white-space: nowrap;
    font-size: clamp(0.4rem, 28cqi, 0.62rem); font-weight: 700; line-height: 1;
    color: #e8e8e8; pointer-events: none;
  }
  .label.bottom { top: auto; bottom: 2px; }
  .label.on-white { color: #262421; }
  @media (prefers-reduced-motion: reduce) { .white { transition: none; } }
</style>
