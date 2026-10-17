<script lang="ts">
  import type { Position } from "chessops/chess";
  import type { Role } from "chessops/types";
  import type { Color, Variant } from "@lilchess/shared";
  import { checksLeft, POCKET_ROLES, pocketOf } from "../game/variantUi";

  // The row above/below the board for variants with extra state: Crazyhouse pockets, Three-check counters.
  let { pos, color, variant, interactive = false, selected = null, layout = "horizontal", onPick, onDrag }: {
    pos: Position;
    color: Color;
    variant: Variant;
    /** Only the player's own pocket, on their own turn, can be used. */
    interactive?: boolean;
    selected?: Role | null;
    layout?: "horizontal" | "vertical";
    onPick?: (role: Role) => void;
    onDrag?: (role: Role, event: MouseEvent) => void;
  } = $props();

  const pocket = $derived(pocketOf(pos, color));
  const checks = $derived(checksLeft(pos));
  const left = $derived(checks ? checks[color] : 0);
</script>

<div class="strip" class:vertical={layout === "vertical"} data-color={color}>
  {#if variant === "crazyhouse"}
    <div class="pocket" role="group" aria-label={`${color} pocket`}>
      {#each POCKET_ROLES as role (role)}
        {@const count = pocket.find((piece) => piece.role === role)?.count ?? 0}
        <button
          type="button"
          class="slot"
          class:available={count > 0}
          class:selected={selected === role}
          disabled={!interactive || count === 0}
          aria-label={`${count} ${role}${count === 1 ? "" : "s"}`}
          aria-pressed={selected === role}
          onclick={() => onPick?.(role)}
          onmousedown={(e) => { if (interactive && e.button === 0) onDrag?.(role, e); }}
        >
          <span class="cg-wrap"><piece class={`${role} ${color}`}></piece></span>
          {#if count > 0}<span class="count">{count}</span>{/if}
        </button>
      {/each}
    </div>
  {:else if variant === "threecheck"}
    <div class="checks" role="img" aria-label={`${left} check${left === 1 ? "" : "s"} left to give`}>
      <span class="label">Checks to give</span>
      {#each [0, 1, 2] as i (i)}<span class="pip" class:on={i < left}></span>{/each}
    </div>
  {/if}
</div>

<style>
  /* A pocket slot is exactly one board square (the strip is as wide as the board), so pieces match the board's. */
  .strip { --pocket-slot-size: 9cqw; display: flex; align-items: center; margin-block: 0.2rem; container-type: inline-size; min-height: var(--pocket-slot-size); }
  .strip.vertical { width: 100%; min-height: 0; height: auto; margin: 0; }
    .pocket { display: flex; gap: 0; align-items: center; width: fit-content; margin-inline: auto; padding: 0.1rem;
        background: var(--pocket-bg); border: 1px solid var(--pocket-border); border-radius: var(--radius);
        box-shadow: inset 2px 2px 5px rgba(0, 0, 0, 0.28), inset -2px -2px 5px rgba(255, 255, 255, 0.55); }
    .slot { position: relative; width: var(--pocket-slot-size); height: var(--pocket-slot-size); flex: 0 0 var(--pocket-slot-size); padding: 0; border: 0; border-radius: 0;
      background: transparent; touch-action: manipulation; }
    .slot.selected { background: transparent; box-shadow: inset 0 0 0 2px var(--green-hi); }
    .strip.vertical .pocket { flex-direction: column; }
    .strip.vertical .slot { --pocket-slot-size: 36px; }
    .slot:hover:not(:disabled) { background: transparent; border-color: transparent; }
  .slot:disabled { opacity: 1; cursor: default; }
  .slot .cg-wrap { position: absolute; inset: 0; display: block; }
  .slot :global(piece) { position: absolute; inset: 0; width: 100%; height: 100%; background-size: cover; pointer-events: none; }
    .slot:not(.available) :global(piece) { opacity: 0.28; }
    .count { position: absolute; right: 1px; bottom: 1px; min-width: 1.2rem; height: 1.2rem; padding: 0 0.25rem;
       display: grid; place-items: center; border-radius: 999px; background: var(--red); color: #fff;
       font-size: 0.75rem; font-weight: 700; line-height: 1; }
  .checks { display: flex; align-items: center; gap: 0.35rem; font-size: 0.8rem; color: var(--muted); }
  .pip { width: 0.7rem; height: 0.7rem; border-radius: 50%; border: 1px solid var(--muted); }
  .pip.on { background: var(--green-hi); border-color: var(--green-hi); }

  @media (max-width: 900px) {
    .strip.vertical { min-height: var(--pocket-slot-size); height: auto; }
    .strip.vertical .pocket { flex-direction: row; }
    .strip.vertical .slot { --pocket-slot-size: 9cqw; }
  }
</style>
