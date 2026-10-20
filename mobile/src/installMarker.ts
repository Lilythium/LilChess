/**
 * Detects the first launch of a fresh install and clears credentials that should not have survived it.
 *
 * Why: the session token lives in platform secure storage (iOS Keychain, Android Keystore-backed storage). On iOS the
 * Keychain is NOT erased when an app is uninstalled, so after a reinstall the app would still find the old token and
 * sign the person straight back in. WebView storage, by contrast, is erased with the app. A marker written to
 * localStorage on first launch therefore works as an "installed since" flag: marker missing means this install has
 * not yet vouched for whatever is in secure storage, so the secure storage is wiped before anything reads it.
 *
 * Failure direction is always "signed out": if localStorage is later evicted by the OS the marker disappears and the
 * person has to sign in again, which is safe. The marker holds no secret and is only a flag.
 */
export const INSTALL_MARKER_KEY = "lilchess.mobile.installMarker.v1";

export interface MarkerStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type FreshInstallResult = "already-initialized" | "cleared" | "skipped";

export async function clearSecureStorageOnFreshInstall(
  storage: MarkerStorage,
  clearSecureStorage: () => Promise<void>,
): Promise<FreshInstallResult> {
  let marker: string | null;
  try {
    marker = storage.getItem(INSTALL_MARKER_KEY);
  } catch {
    return "skipped"; // storage unavailable: cannot tell, and wiping on every launch would sign everyone out
  }
  if (marker !== null) return "already-initialized";

  try {
    await clearSecureStorage();
  } catch {
    return "skipped"; // leave the marker unset so the next launch tries again
  }
  try {
    storage.setItem(INSTALL_MARKER_KEY, "1");
  } catch {
    return "cleared"; // wiped, but could not record it: next launch wipes again, which only signs the person out
  }
  return "cleared";
}
