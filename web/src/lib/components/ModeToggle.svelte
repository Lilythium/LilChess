<script>
  let { value = $bindable() } = $props();

  /**
   * @param {{ key: string; preventDefault: () => void; }} event
   */
  function toggleMode(event) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      value = value === "live" ? "correspondence" : "live";
    }
  }

  function handleClick() {
    value = value === "live" ? "correspondence" : "live";
  }
</script>

<div
  class="toggle-switch"
  class:correspondence={value === "correspondence"}
  role="switch"
  aria-checked={value === "correspondence"}
  tabindex="0"
  onclick={handleClick}
  onkeydown={toggleMode}
>
  <div class="toggle-thumb"></div>
  <span class="toggle-label">Live</span>
  <span class="toggle-label">Correspondence</span>
</div>

<style>
  .toggle-switch {
    position: relative;
    display: flex;
    width: min(280px, 100%);
    flex: 0 1 280px;
    height: var(--mode-toggle-height);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    cursor: pointer;
    user-select: none;
    /* Optional: add a subtle shadow for depth */
    box-shadow: inset 0 1px 3px rgba(0,0,0,0.1);
  }

  .toggle-thumb {
    position: absolute;
    top: 3px;
    left: 3px;
    width: calc(50% - 3px);
    height: calc(100% - 6px);
    background: var(--green);
    /* Nest the curves cleanly by subtracting the offset from the radius */
    border-radius: max(2px, calc(var(--radius) - 3px));
    transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .toggle-switch.correspondence .toggle-thumb {
    transform: translateX(100%);
  }

  .toggle-label {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1;
    font-size: 14px;
    font-weight: 500;
    color: var(--muted); 
    transition: color 0.25s ease;
  }

  .toggle-switch:not(.correspondence) .toggle-label:first-of-type,
  .toggle-switch.correspondence .toggle-label:last-of-type {
    color: var(--text-hi);
  }
</style>