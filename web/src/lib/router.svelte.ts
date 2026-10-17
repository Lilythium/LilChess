const read = () => location.hash.slice(1) || "/";
export const route = $state({ path: read() });
addEventListener("hashchange", () => { route.path = read(); scrollTo(0, 0); });

export function navigate(path: string) { location.hash = path; }
const NEW_GAME_SOUND_KEY = "lilchess.new-game-sound";

export function navigateToNewGame(gameId: string): void {
  try { sessionStorage.setItem(NEW_GAME_SOUND_KEY, gameId); } catch { /* storage may be unavailable */ }
  navigate(`/game/${gameId}`);
}

export function consumeNewGameSound(gameId: string): boolean {
  try {
    if (sessionStorage.getItem(NEW_GAME_SOUND_KEY) !== gameId) return false;
    sessionStorage.removeItem(NEW_GAME_SOUND_KEY);
    return true;
  } catch {
    return false;
  }
}

export function matchRoute(path: string, pattern: string): Record<string, string> | null {
  const names: string[] = [];
  const re = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, n) => { names.push(n); return "([^/]+)"; }) + "/?$");
  const m = re.exec(path);
  return m ? Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1]!)])) : null;
}