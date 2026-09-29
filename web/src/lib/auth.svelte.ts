import { api } from "./api";
import { navigate } from "./router.svelte";

export interface User { id: number; username: string; created_at: number; is_admin: number }
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
export async function logout() {
  await api("/api/logout", { method: "POST" });
  auth.user = null;
  navigate("/login");
}