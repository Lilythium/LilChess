import { Capacitor } from "@capacitor/core";
import { SecureStoragePlugin } from "capacitor-secure-storage-plugin";
import { normalizeServerAddress } from "./serverSelection.js";

const TOKEN_KEY_PREFIX = "lilchess.session.v1.";

/** Exposed for tests; tokens from different server origins must never share a storage key. */
export function nativeSessionStorageKey(serverUrl: string): string {
  const origin = normalizeServerAddress(serverUrl).serverUrl;
  return `${TOKEN_KEY_PREFIX}${encodeURIComponent(origin)}`;
}

function requireNativeSecureStorage(): void {
  // The plugin deliberately falls back to browser storage on the web. Never permit that fallback
  // for session credentials; this module is intended for the dynamically imported native bundle.
  if (!Capacitor.isNativePlatform()) {
    throw new Error("Secure session storage is available only in the native LilChess app.");
  }
}

export async function saveNativeSessionToken(serverUrl: string, token: string): Promise<void> {
  requireNativeSecureStorage();
  if (!/^[a-f\d]{64}$/i.test(token)) throw new Error("The server returned an invalid session token.");
  const result = await SecureStoragePlugin.set({ key: nativeSessionStorageKey(serverUrl), value: token });
  if (result.value !== true) throw new Error("The session token could not be saved to secure device storage.");
}

export async function readNativeSessionToken(serverUrl: string): Promise<string | null> {
  requireNativeSecureStorage();
  const key = nativeSessionStorageKey(serverUrl);
  const { value: keys } = await SecureStoragePlugin.keys();
  if (!keys.includes(key)) return null;

  const result = await SecureStoragePlugin.get({ key });
  if (/^[a-f\d]{64}$/i.test(result.value)) return result.value;
  await SecureStoragePlugin.remove({ key });
  return null;
}

export async function clearNativeSessionToken(serverUrl: string): Promise<void> {
  requireNativeSecureStorage();
  const key = nativeSessionStorageKey(serverUrl);
  const { value: keys } = await SecureStoragePlugin.keys();
  if (!keys.includes(key)) return;
  const result = await SecureStoragePlugin.remove({ key });
  if (result.value !== true) throw new Error("The local session token could not be removed from secure device storage.");
}
