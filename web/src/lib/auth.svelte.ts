import { api } from "./api";
import { disablePush } from "./push";
import { navigate } from "./router.svelte";

export interface User { id: number; username: string; created_at: number; is_admin: number; is_guest: number; email: string | null }
export const auth = $state<{ user: User | null; ready: boolean }>({ user: null, ready: false });

export async function loadMe() {
  try { auth.user = (await api<{ user: User }>("/api/me")).user; }
  catch { auth.user = null; }
  finally { auth.ready = true; }
}
export async function login(username: string, password: string) {
  auth.user = (await api<{ user: User }>("/api/login", { body: { username, password } })).user;
}
export async function register(username: string, password: string, inviteCode?: string) {
  auth.user = (await api<{ user: User }>("/api/register", { body: { username, password, inviteCode } })).user;
}
export async function playAsGuest(challengeId: string) {
  auth.user = (await api<{ user: User }>("/api/guest", { body: { challengeId } })).user;
}

// The native app signs in (and out) in its own shell, around the shared UI. It installs these so the shared
// pieces (the header's Log out button, the first user lookup) work without knowing which platform they run on.
let logoutHandler: (() => Promise<void>) | null = null;

export function setLogoutHandler(next: (() => Promise<void>) | null): void {
  logoutHandler = next;
}

/** Start from a user the shell already verified, or from none after signing out. Marks auth as loaded. */
export function setSignedInUser(user: User | null): void {
  auth.user = user;
  auth.ready = true;
}

export async function logout() {
  if (logoutHandler) {
    await logoutHandler();
    return;
  }
  // Stop this browser receiving the account's notifications. Needs the session, so it comes first; it must
  // never block signing out (or a person on a shared device would keep getting someone else's pushes).
  await Promise.race([disablePush().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
  await api("/api/logout", { method: "POST" });
  auth.user = null;
  navigate("/login");
}