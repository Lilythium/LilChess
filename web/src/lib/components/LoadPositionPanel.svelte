<script lang="ts">
  let { onLoad }: {
    /** Returns an error message, or null on success (optionally with a note to show). */
    onLoad: (text: string) => Promise<{ error?: string; note?: string }>;
  } = $props();

  let open = $state(false);
  let text = $state("");
  let error = $state<string | null>(null);
  let note = $state<string | null>(null);
  let busy = $state(false);

  async function load() {
    if (busy) return;
    busy = true;
    try {
      const result = await onLoad(text);
      error = result.error ?? null;
      note = result.note ?? null;
      if (!result.error) {
        text = "";
        open = false;
      }
    } finally {
      busy = false;
    }
  }

  async function pickFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (file) text = await file.text();
    input.value = "";
  }
</script>

<section class="box">
  <button type="button" class="toggle" aria-expanded={open} onclick={() => (open = !open)}>
    <span>Load PGN or FEN</span><span aria-hidden="true">{open ? "−" : "+"}</span>
  </button>

  {#if open}
    <textarea
      bind:value={text}
      rows="6"
      spellcheck="false"
      placeholder="Paste a PGN (the first game is used) or a FEN position"
      aria-label="PGN or FEN"
    ></textarea>
    <div class="row">
      <button type="button" class="primary" disabled={!text.trim() || busy} onclick={load}>{busy ? "Loading…" : "Load"}</button>
      <label class="file">
        <input type="file" accept=".pgn,.txt,text/plain" onchange={pickFile} />
        <span>Choose file</span>
      </label>
    </div>
  {/if}

  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if note}<p class="note">{note}</p>{/if}
</section>

<style>
  .box { display: flex; flex-direction: column; gap: 0.5rem; padding: 0.7rem; background: var(--panel); border-radius: var(--radius); }
  .toggle {
    display: flex; justify-content: space-between; width: 100%; padding: 0; background: transparent;
    border: 0; color: var(--text-hi); font-weight: 600;
  }
  textarea {
    width: 100%; resize: vertical; padding: 0.55rem 0.7rem; background: var(--bg); color: var(--text-hi);
    border: 1px solid var(--border); border-radius: var(--radius); font: 0.8rem/1.4 ui-monospace, monospace;
  }
  textarea:focus { outline: none; border-color: var(--green); }
  .row { display: flex; gap: 0.5rem; align-items: center; }
  .file { cursor: pointer; color: var(--blue); font-size: 0.9rem; }
  .file input { display: none; }
  .error, .note { margin: 0; font-size: 0.85rem; }
  .note { color: var(--muted); }
</style>
