<script lang="ts">
  import { buildAppLink, type InviteTarget } from "../../../../mobile/src/inviteLink.js";
  import { isNativeApp } from "../platform";

  let { target }: { target: InviteTarget } = $props();

  // Only offered on touch devices, and never inside the app itself. If the app is not installed the link simply
  // does nothing, so it is a quiet text link below the invite rather than a banner.
  const href = $derived.by(() => {
    if (isNativeApp() || typeof matchMedia !== "function" || !matchMedia("(pointer: coarse)").matches) return null;
    try {
      return buildAppLink(location.origin, target);
    } catch {
      return null; // an origin the app could not connect to (for example a path-prefixed deployment)
    }
  });
</script>

{#if href}
  <p class="muted open-in-app"><a {href}>Open in the LilChess app</a></p>
{/if}

<style>
  .open-in-app { margin: 0.25rem 0 0.75rem; font-size: 0.9rem; }
</style>
