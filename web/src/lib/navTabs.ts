// Which phone tab-bar tab a route belongs to, and which routes hide the bar entirely.
// Kept free of Svelte so it can be unit-tested.

export type TabId = "play" | "games" | "watch" | "tournaments" | "more";

/** Routes that bring their own bottom controls (a sticky action dock, a board toolbar) or have no signed-in chrome. */
export function hidesBottomNav(path: string): boolean {
  return /^\/game\/[^/]+\/?$/.test(path)
    || path === "/local"
    || path === "/analysis"
    || path.startsWith("/analysis/")
    || path.startsWith("/c/")
    || path.startsWith("/s/");
}

export function activeTab(path: string): TabId {
  if (path === "/") return "play";
  if (path === "/games" || path === "/imported") return "games";
  if (path === "/watch") return "watch";
  if (path === "/tournaments" || path.startsWith("/tournament/")) return "tournaments";
  return "more";
}
