<script lang="ts">
  type Role = "q" | "r" | "b" | "n";
  let { onPick, onCancel }: { onPick: (role: Role) => void; onCancel: () => void } = $props();

  const options: { role: Role; glyph: string }[] = [
    { role: "q", glyph: "♕" },
    { role: "r", glyph: "♖" },
    { role: "b", glyph: "♗" },
    { role: "n", glyph: "♘" },
  ];
</script>

<div class="overlay">
  <button class="backdrop" aria-label="Cancel promotion" onclick={onCancel}></button>
  <div class="choices">
    {#each options as o (o.role)}
      <button aria-label={o.role} onclick={() => onPick(o.role)}>{o.glyph}</button>
    {/each}
  </div>
</div>

<style>
  .overlay { position: absolute; inset: 0; z-index: 10; display: grid; place-items: center; }
  .backdrop { position: absolute; inset: 0; padding: 0; border-radius: 0; background: rgba(0, 0, 0, 0.6); }
  .backdrop:hover:not(:disabled) { background: rgba(0, 0, 0, 0.6); }
  .choices { position: relative; display: flex; gap: 0.5rem; padding: 0.75rem;
             background: var(--panel); border-radius: var(--radius); }
  .choices button { font-size: 3rem; line-height: 1; padding: 0.25rem 0.75rem; }
</style>