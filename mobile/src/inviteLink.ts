import { normalizeServerAddress, ServerSelectionError } from "./serverSelection.js";

/** Custom URL scheme the app registers (Info.plist / AndroidManifest). HTTPS app links are Phase 7. */
export const INVITE_URL_SCHEME = "lilchess";

export type InviteTarget =
  | { kind: "challenge"; id: string }
  | { kind: "simul"; code: string };

export interface InviteLink {
  /** Canonical origin the invite belongs to. Never a credential, never trusted until the server confirms the invite. */
  serverUrl: string;
  target: InviteTarget;
}

// Challenge ids and simul invite codes are both random hex (server/src/validation.ts `Id`).
const TOKEN = /^[a-f\d]{8,16}$/i;
const MAX_LINK_LENGTH = 2048;

/**
 * Understands the two shapes an invite can arrive in:
 *
 *   https://chess.example.com/#/c/ab12cd34ef56ab78        what the website and the app share (also `#/s/<code>`)
 *   lilchess://invite?server=https%3A%2F%2Fchess.example.com&c=ab12cd34ef56ab78
 *
 * Returns null for anything else. A link only names a server and a target: it is not authentication and not proof
 * that the invite is valid, so callers must still ask the server.
 */
export function parseInviteLink(input: string): InviteLink | null {
  const raw = input.trim();
  if (!raw || raw.length > MAX_LINK_LENGTH) return null;

  const scheme = /^([a-z][a-z\d+.-]*):\/\//i.exec(raw)?.[1]?.toLowerCase();
  if (scheme === INVITE_URL_SCHEME) return parseAppLink(raw);
  if (scheme === undefined) return parseWebLink(`https://${raw}`); // "chess.example.com/#/c/…" pasted without a scheme
  if (scheme === "http" || scheme === "https") return parseWebLink(raw);
  return null;
}

function parseWebLink(raw: string): InviteLink | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.username || url.password || url.pathname !== "/") return null;

  const target = targetFromHash(url.hash);
  const serverUrl = serverOrigin(url.origin);
  return target && serverUrl ? { serverUrl, target } : null;
}

function parseAppLink(raw: string): InviteLink | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.hostname.toLowerCase() !== "invite" || url.username || url.password) return null;

  const server = url.searchParams.getAll("server");
  const challenge = url.searchParams.getAll("c");
  const simul = url.searchParams.getAll("s");
  if (server.length !== 1 || challenge.length + simul.length !== 1) return null;

  const serverUrl = serverOrigin(server[0]!);
  if (!serverUrl) return null;
  if (challenge.length === 1) return TOKEN.test(challenge[0]!) ? { serverUrl, target: { kind: "challenge", id: challenge[0]! } } : null;
  return TOKEN.test(simul[0]!) ? { serverUrl, target: { kind: "simul", code: simul[0]! } } : null;
}

function targetFromHash(hash: string): InviteTarget | null {
  const match = /^#\/([cs])\/([^/]+)\/?$/i.exec(hash);
  if (!match || !TOKEN.test(match[2]!)) return null;
  return match[1]!.toLowerCase() === "c"
    ? { kind: "challenge", id: match[2]! }
    : { kind: "simul", code: match[2]! };
}

/** Same validation as the server selector: credentials, paths, queries and unsupported schemes are all rejected. */
function serverOrigin(candidate: string): string | null {
  try {
    return normalizeServerAddress(candidate).serverUrl;
  } catch (error) {
    if (error instanceof ServerSelectionError) return null;
    throw error;
  }
}

/** The hash route the web UI uses for this invite (`/c/<id>` or `/s/<code>`). */
export function inviteRoute(target: InviteTarget): string {
  return target.kind === "challenge" ? `/c/${target.id}` : `/s/${target.code}`;
}

/** The https link people share. It works in any browser, and pasted into the app. */
export function buildShareLink(serverUrl: string, target: InviteTarget): string {
  return `${normalizeServerAddress(serverUrl).serverUrl}/#${inviteRoute(target)}`;
}

/** A link that opens the installed app directly. */
export function buildAppLink(serverUrl: string, target: InviteTarget): string {
  const server = encodeURIComponent(normalizeServerAddress(serverUrl).serverUrl);
  const key = target.kind === "challenge" ? `c=${target.id}` : `s=${target.code}`;
  return `${INVITE_URL_SCHEME}://invite?server=${server}&${key}`;
}

export function sameServer(a: string, b: string): boolean {
  const first = serverOrigin(a);
  return first !== null && first === serverOrigin(b);
}
