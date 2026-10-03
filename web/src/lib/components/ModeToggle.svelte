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
    width: 280px;
    height: 44px;
    background: #2a2a2a;
    border-radius: 9999px;
    cursor: pointer;
    user-select: none;
    overflow: hidden;
  }

  .toggle-thumb {
    position: absolute;
    top: 3px;
    left: 3px;
    width: calc(50% - 3px);
    height: calc(100% - 6px);
    background: rgb(98, 153, 36);
    border-radius: 9999px;
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
    /* Unselected text color */
    color: #ffffff; 
    transition: color 0.25s ease;
  }

  /* Selected (highlighted) text color turns white */
  .toggle-switch:not(.correspondence) .toggle-label:first-of-type,
  .toggle-switch.correspondence .toggle-label:last-of-type {
    color: #ffffff;
  }
</style>