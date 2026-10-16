<script lang="ts">
  import { parseCustomClock } from "../timeControl";

  // Any live clock under 6 hours: starting minutes (decimals allowed) plus an increment in seconds.
  let { minutes = $bindable(5), increment = $bindable(0) }: { minutes?: number; increment?: number } = $props();

  const check = $derived(parseCustomClock(minutes, increment));
</script>

<div class="custom-clock">
  <label>Minutes
    <input type="number" inputmode="decimal" min="0.17" max="359" step="any" bind:value={minutes} aria-invalid={!check.ok} />
  </label>
  <label>Increment (s)
    <input type="number" inputmode="numeric" min="0" max="180" step="1" bind:value={increment} aria-invalid={!check.ok} />
  </label>
  <p class="hint muted" class:bad={!check.ok} role={check.ok ? undefined : "alert"}>
    {check.ok ? "Any time from 10 seconds to just under 6 hours." : check.error}
  </p>
</div>

<style>
  .custom-clock { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; align-items: end; }
  .hint { grid-column: 1 / -1; margin: 0; font-size: 0.8rem; }
  .bad { color: var(--red); }
</style>
