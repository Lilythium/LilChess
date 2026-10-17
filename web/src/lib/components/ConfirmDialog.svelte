<script lang="ts">
  import { onMount } from "svelte";
  import { answerConfirm, subscribeConfirm, type ConfirmRequest } from "../confirm";

  // Mounted once in App.svelte. Pages call askConfirm() from ../confirm.
  let request = $state<ConfirmRequest | null>(null);
  let confirmButton = $state<HTMLButtonElement>();

  onMount(() => subscribeConfirm((next) => (request = next)));

  // Land on Cancel for destructive questions, so a stray Enter or tap never confirms them.
  let cancelButton = $state<HTMLButtonElement>();
  $effect(() => {
    if (!request) return;
    (request.danger ? cancelButton : confirmButton)?.focus({ preventScroll: true });
  });
</script>

<svelte:window onkeydown={(e) => { if (request && e.key === "Escape") answerConfirm(false); }} />

{#if request}
  <div class="root">
    <button class="backdrop" type="button" tabindex="-1" aria-label={request.cancelLabel} onclick={() => answerConfirm(false)}></button>
    <div class="dialog" role="alertdialog" aria-modal="true" aria-label={request.message}>
      <p>{request.message}</p>
      <div class="actions">
        <button type="button" bind:this={cancelButton} onclick={() => answerConfirm(false)}>{request.cancelLabel}</button>
        <button type="button" bind:this={confirmButton} class={request.danger ? "danger-solid" : "primary"} onclick={() => answerConfirm(true)}>{request.confirmLabel}</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .root {
    position: fixed; inset: 0; z-index: 300; display: grid; place-items: center;
    padding: max(1rem, env(safe-area-inset-top, 0px)) max(1rem, env(safe-area-inset-right, 0px))
             max(1rem, env(safe-area-inset-bottom, 0px)) max(1rem, env(safe-area-inset-left, 0px));
  }
  .backdrop { position: absolute; inset: 0; padding: 0; border: 0; border-radius: 0; background: rgba(0, 0, 0, 0.6); }
  .dialog {
    position: relative; width: min(100%, 360px); padding: 1.25rem; background: var(--panel);
    border: 1px solid var(--border); border-radius: var(--radius); box-shadow: 0 8px 28px rgba(0, 0, 0, 0.55);
  }
  p { margin: 0 0 1.25rem; color: var(--text-hi); overflow-wrap: anywhere; }
  .actions { display: flex; gap: 0.5rem; }
  .actions button { flex: 1; min-height: var(--tap); }
  .danger-solid { background: var(--red); color: #fff; }
</style>
