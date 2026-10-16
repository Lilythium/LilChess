<script lang="ts">
  import type { PromotionRole } from "../game/variantUi";
  type Role = PromotionRole;
  // `roles` lets Antichess offer a king as well.
  let { onPick, onCancel, roles = ["q", "r", "b", "n"] }: {
    onPick: (role: Role) => void; onCancel: () => void; roles?: Role[];
  } = $props();

  const ALL: Record<Role, { glyph: string; name: string }> = {
    q: { glyph: "♕", name: "Queen" },
    r: { glyph: "♖", name: "Rook" },
    b: { glyph: "♗", name: "Bishop" },
    n: { glyph: "♘", name: "Knight" },
    k: { glyph: "♔", name: "King" },
  };
  const options = $derived(roles.map((role) => ({ role, ...ALL[role] })));
</script>

<div class="overlay">
  <button class="backdrop" aria-label="Cancel promotion" onclick={onCancel}></button>
  <div class="choices">
    {#each options as o (o.role)}
      <button aria-label={o.name} onclick={() => onPick(o.role)}>{o.glyph}</button>
    {/each}
  </div>
</div>

<style>
  .overlay { position: absolute; inset: 0; z-index: 10; display: grid; place-items: center; }
  .backdrop { position: absolute; inset: 0; padding: 0; border-radius: 0; background: rgba(0, 0, 0, 0.6); }
  .choices { position: relative; display: flex; gap: 0.5rem; padding: 0.75rem; max-width: 94%;
             background: var(--panel); border-radius: var(--radius); }
  .choices button { font-size: clamp(2rem, 13cqw, 3rem); line-height: 1; padding: 0.25rem 0.5rem; }
</style>