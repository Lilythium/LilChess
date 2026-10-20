import { mount } from "svelte";
import NativeRoot from "./NativeRoot.svelte";
import { clearSecureStorageOnFreshInstall } from "../../../mobile/src/installMarker.js";
import { clearAllNativeSessionTokens } from "../../../mobile/src/secureSession.js";

/** Entry point imported only by the Vite `native` build. */
export async function startNative(): Promise<void> {
  const target = document.getElementById("app");
  if (!target) throw new Error("LilChess mobile startup could not find the app root element.");
  // Must finish before the shell reads any saved session: see mobile/src/installMarker.ts.
  try {
    await clearSecureStorageOnFreshInstall(localStorage, clearAllNativeSessionTokens);
  } catch {
    // Never block startup on this housekeeping.
  }
  mount(NativeRoot, { target });
}
