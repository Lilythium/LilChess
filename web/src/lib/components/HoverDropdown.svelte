<script lang="ts" generics="T extends string">
  type Option<Value extends string> = {
    value: Value;
    label: string;
  };

  let {
    value = $bindable<T>(),
    options,
    label,
    width = "max-content",
  }: {
    value: T;
    options: readonly Option<T>[];
    label: string;
    width?: string;
  } = $props();

  let isOpen = $state(false);

  // Hover-open only suits a real pointer. On touch, iOS fires mouseenter just before the
  // tap's click, so the menu opened and the <summary> click closed it again.
  const canHover = typeof matchMedia !== "undefined" && matchMedia("(hover: hover)").matches;
  let root: HTMLDetailsElement | undefined;

  function onOutside(e: PointerEvent) {
    if (isOpen && root && !root.contains(e.target as Node)) isOpen = false;
  }
  const selectedLabel = $derived(
    options.find((option) => option.value === value)?.label ?? label,
  );
</script>

<svelte:window
  onpointerdown={onOutside}
  onkeydown={(e) => { if (e.key === "Escape") isOpen = false; }}
/>

<details
  bind:this={root}
  class="hover-dropdown"
  style:--dropdown-width={width}
  bind:open={isOpen}
  onmouseenter={() => { if (canHover) isOpen = true; }}
  onmouseleave={() => { if (canHover) isOpen = false; }}
>
  <summary aria-label={label}>
    {selectedLabel}
    <span class="caret" aria-hidden="true"></span>
  </summary>
  <div class="options" role="group" aria-label={label}>
    {#each options as option (option.value)}
      <button
        type="button"
        class:selected={value === option.value}
        aria-pressed={value === option.value}
        onclick={() => {
          value = option.value;
          isOpen = false;
        }}
      >
        {option.label}
      </button>
    {/each}
  </div>
</details>

<style>
  .hover-dropdown {
    position: relative;
    flex: 0 1 var(--dropdown-width);
    width: var(--dropdown-width);
    min-width: 140px;
  }

  summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: var(--mode-toggle-height, 44px);
    padding: 0 .7rem;
    background: var(--bg);
    color: var(--text-hi);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    cursor: pointer;
    list-style: none;
    white-space: nowrap;
  }

  summary::-webkit-details-marker {
    display: none;
  }

  summary:focus-visible,
  .options button:focus-visible {
    outline: 2px solid var(--green);
    outline-offset: 2px;
  }

  .caret {
    flex: 0 0 auto;
    width: .5rem;
    height: .5rem;
    margin-left: .75rem;
    border-right: 1px solid currentColor;
    border-bottom: 1px solid currentColor;
    transform: rotate(45deg) translateY(-2px);
    transition: transform .2s;
  }

  details[open] .caret {
    transform: rotate(225deg) translateY(-2px);
  }

  .options {
    position: absolute;
    top: 100%;
    right: 0;
    z-index: 5;
    display: grid;
    min-width: 100%;
    width: max-content;
    max-width: min(18rem, 80vw);
    padding: .25rem;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: 0 4px 12px rgba(0, 0, 0, .25);
  }

  .options button {
    width: 100%;
    border: 0;
    border-radius: 0;
    text-align: left;
    white-space: nowrap;
  }

  .options button.selected {
    background: var(--green);
    color: #fff;
  }

  .options button.selected:hover {
    background: var(--green-hi);
  }

  @media (max-width: 600px) {
  .hover-dropdown { width: 100%; flex: 1 1 100%; }
  }
</style>