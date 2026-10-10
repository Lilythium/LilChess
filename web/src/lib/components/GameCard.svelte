<script lang="ts">
  import MiniBoard from "./MiniBoard.svelte";

  let { href, fen, lastMove = null, orientation = "white", title, subtitle = "" }: {
    href: string;
    fen: string;
    lastMove?: string | null;
    orientation?: "white" | "black";
    title: string;
    subtitle?: string;
  } = $props();
</script>

<a class="card" {href}>
  <MiniBoard {fen} {lastMove} {orientation} />
  <span class="title">{title}</span>
  {#if subtitle}<span class="sub">{subtitle}</span>{/if}
</a>

<style>
  .card { display: flex; flex-direction: column; gap: 0.35rem; padding: 0.5rem;
          background: var(--panel-hi); border-radius: var(--radius); color: var(--text); }
  @media (hover: hover) {
    .card:hover { background: #3a3835; text-decoration: none; }
  }
  .title { color: var(--text-hi); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sub { color: var(--muted); font-size: 0.85rem; }
</style>