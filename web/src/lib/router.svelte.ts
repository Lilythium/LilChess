const read = () => location.hash.slice(1) || "/";
export const route = $state({ path: read() });
addEventListener("hashchange", () => { route.path = read(); scrollTo(0, 0); });

export function navigate(path: string) { location.hash = path; }

export function matchRoute(path: string, pattern: string): Record<string, string> | null {
  const names: string[] = [];
  const re = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, n) => { names.push(n); return "([^/]+)"; }) + "/?$");
  const m = re.exec(path);
  return m ? Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1]!)])) : null;
}