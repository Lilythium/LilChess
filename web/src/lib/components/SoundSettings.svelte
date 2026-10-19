<script lang="ts">
  import { getSoundVolume, isSoundEnabled, playSound, setSoundEnabled, setSoundVolume, unlockAudio } from "../audio/audio";
  import { isNativeApp } from "../platform";

  let enabled = $state(isSoundEnabled());
  let volume = $state(Math.round(getSoundVolume() * 100));

  function onToggle(value: boolean) {
    enabled = value;
    setSoundEnabled(value);
    if (value) preview();
  }

  function onVolume(value: number) {
    volume = value;
    setSoundVolume(value / 100);
  }

  // A tap here is the user gesture iOS wants before it lets the page play audio at all.
  function preview() {
    unlockAudio();
    playSound("move");
  }
</script>

<div class="panel">
  <h2>Sound</h2>
  <label class="opt">
    <input type="checkbox" checked={enabled} onchange={(e) => onToggle(e.currentTarget.checked)} />
    Play move, capture and game sounds
  </label>
  <label class="vol" class:off={!enabled}>
    <span>Volume</span>
    <input
      type="range" min="0" max="100" step="5" value={volume} disabled={!enabled}
      aria-label="Sound volume"
      oninput={(e) => onVolume(e.currentTarget.valueAsNumber)}
      onchange={preview}
    />
    <span class="pct">{volume}%</span>
  </label>
  {#if isNativeApp()}
    <p class="muted">
      This sets LilChess's own volume on top of your phone's. Silent or Do Not Disturb modes and the hardware volume
      still apply, and sounds stay off while the app is in the background.
    </p>
  {/if}
</div>

<style>
  .opt { display: flex; align-items: center; gap: 0.5rem; padding: 0.35rem 0; cursor: pointer; }
  .vol { display: flex; align-items: center; gap: 0.75rem; padding: 0.35rem 0; }
  .vol.off { opacity: 0.55; }
  .vol input { flex: 1; min-width: 0; }
  .pct { min-width: 3ch; text-align: right; font-variant-numeric: tabular-nums; }
</style>
