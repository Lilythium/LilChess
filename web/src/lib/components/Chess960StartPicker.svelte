<script lang="ts">
  import { CHESS960_MAX_ID, CHESS960_MIN_ID } from "@lilchess/shared";

  let { value, onSelect }: { value: number; onSelect: (id: number) => void } = $props();

  function update(event: Event) {
    const id = (event.currentTarget as HTMLInputElement).valueAsNumber;
    if (Number.isInteger(id) && id >= CHESS960_MIN_ID && id <= CHESS960_MAX_ID) onSelect(id);
  }
</script>

<div class="picker">
  <label for="chess960-start-id">Start ID</label>
  <input id="chess960-start-id" type="number" min={CHESS960_MIN_ID} max={CHESS960_MAX_ID} step="1" value={value} oninput={update} />
  <span class="range">{CHESS960_MIN_ID}–{CHESS960_MAX_ID}</span>
</div>

<style>
  .picker { display: flex; flex-direction: column; align-items: flex-start; gap: 0.35rem; }
  label, .range { font-size: 0.8rem; white-space: nowrap; }
  .range { color: var(--muted); }
  input { width: 100%; min-width: 0; padding: 0.35rem 0.4rem; }
  @media (max-width: 800px) {
    .picker { flex-direction: row; align-items: center; }
    input { width: 5.5rem; }
  }
</style>