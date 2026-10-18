import { describe, expect, it } from "vitest";
import { activeTab, hidesBottomNav } from "./navTabs";

describe("activeTab", () => {
  it.each([
    ["/", "play"],
    ["/games", "games"],
    ["/imported", "games"],
    ["/watch", "watch"],
    ["/tournaments", "tournaments"],
    ["/tournament/abc", "tournaments"],
    ["/simuls", "more"],
    ["/simul/abc", "more"],
    ["/leaderboard/chess960", "more"],
    ["/games-db/standard", "more"],
    ["/u/Bob", "more"],
    ["/settings", "more"],
    ["/admin", "more"],
  ])("%s -> %s", (path, tab) => expect(activeTab(path)).toBe(tab));
});

describe("hidesBottomNav", () => {
  it.each(["/game/abc123", "/game/abc123/", "/local", "/analysis", "/analysis/abc", "/analysis/imported/abc", "/c/xyz", "/s/code"])(
    "hides on %s", (path) => expect(hidesBottomNav(path)).toBe(true));

  it.each(["/", "/games", "/watch", "/tournaments", "/tournament/abc", "/simuls", "/simul/abc", "/u/Bob", "/settings", "/leaderboard"])(
    "shows on %s", (path) => expect(hidesBottomNav(path)).toBe(false));
});
