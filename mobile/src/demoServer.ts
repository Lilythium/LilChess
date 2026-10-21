import { normalizeServerAddress, type NormalizedServerAddress } from "./serverSelection.js";

/**
 * The built-in demo server, set at build time with VITE_LILCHESS_DEMO_URL (see docs/mobile-demo-server.md).
 * It only pre-fills the server picker: the person can still enter any other server, and the address goes through
 * the same health and compatibility check as one they typed. Returns null when unset or unusable, which simply
 * hides the demo shortcut. It must be HTTPS: store reviewers and new users should never be sent over plain HTTP.
 */
export function resolveDemoServer(raw: string | undefined): NormalizedServerAddress | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const address = normalizeServerAddress(value);
    return address.serverUrl.startsWith("https://") ? address : null;
  } catch {
    return null;
  }
}
