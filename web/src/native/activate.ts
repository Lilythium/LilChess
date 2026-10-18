import { createNativeRealtime } from "../../../mobile/src/nativeRealtime.js";
import { setApiHandler } from "../lib/api";
import { NATIVE_POLICY, resetSocketRuntime, setSocketRuntime } from "../lib/ws/runtime";

/**
 * Point the shared web client (api(), game/simul/user sockets) at the selected self-hosted server. Call after
 * the user signs in or a saved session is restored, and again whenever they pick a different server: any
 * sockets still open to the previous server are closed here, and the new instance gets its own token cache.
 */
export function activateNativeServer(serverUrl: string, onSessionExpired?: () => void): void {
  const realtime = createNativeRealtime({ serverUrl, onSessionExpired });
  setApiHandler((path, init) => realtime.api(path, init));
  setSocketRuntime({
    transport: { open: (path) => realtime.openSocket(path) },
    policy: NATIVE_POLICY,
  });
}

/** Sign-out or leaving the server: back to the browser defaults, with nothing left open. */
export function deactivateNativeServer(): void {
  setApiHandler(null);
  resetSocketRuntime();
}
