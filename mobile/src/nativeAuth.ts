import { NativeApiError, nativeRequest } from "./nativeApi.js";
import {
  clearNativeSessionToken,
  readNativeSessionToken,
  saveNativeSessionToken,
} from "./secureSession.js";

export interface NativeUser {
  id: number;
  username: string;
  created_at: number;
  is_admin: number;
  is_guest: number;
  email: string | null;
}

export interface NativeSession {
  /** Kept in memory only while this session is active. */
  token: string;
  user: NativeUser;
}

interface AuthResponse {
  ok: true;
  user: NativeUser;
  sessionToken: string;
}

export async function loginNative(
  serverUrl: string,
  username: string,
  password: string,
): Promise<NativeSession> {
  return authenticate(serverUrl, "/native/login", { username, password });
}

export async function registerNative(
  serverUrl: string,
  username: string,
  password: string,
  inviteCode?: string,
): Promise<NativeSession> {
  const body: Record<string, string> = { username, password };
  if (inviteCode?.trim()) body.inviteCode = inviteCode.trim();
  return authenticate(serverUrl, "/native/register", body);
}

/** Guest credentials are scoped to a valid, non-targeted invite on the selected server. */
export async function createNativeGuestSession(
  serverUrl: string,
  challengeId: string,
): Promise<NativeSession> {
  if (!/^[a-f\d]{8,16}$/i.test(challengeId)) {
    throw new NativeApiError(400, "The invite challenge ID is invalid.");
  }
  return authenticate(serverUrl, "/native/guest", { challengeId });
}

export async function restoreNativeSession(serverUrl: string): Promise<NativeSession | null> {
  const token = await readNativeSessionToken(serverUrl);
  if (!token) return null;

  try {
    const response = await nativeRequest<{ ok: boolean; user: unknown }>(serverUrl, "/me", { token });
    if (response.ok !== true || !isNativeUser(response.user)) {
      throw new NativeApiError(502, "The server returned an invalid account response.");
    }
    return { token, user: response.user };
  } catch (error) {
    if (error instanceof NativeApiError && (error.status === 401 || error.status === 403)) {
      // Invalid/revoked tokens are removed once. Do not loop or retry an unauthorized request.
      await clearNativeSessionToken(serverUrl);
      return null;
    }
    throw error;
  }
}

/** Always clears the device token, even when the server cannot be reached to revoke it. */
export async function logoutNative(serverUrl: string, session: NativeSession): Promise<void> {
  let remoteError: unknown;
  try {
    await nativeRequest<{ ok: boolean }>(serverUrl, "/logout", {
      method: "POST",
      token: session.token,
    });
  } catch (error) {
    // A 401 means the server already considers the token invalid; other failures mean revocation
    // could not be confirmed, but must not keep the secret on this device after the user logs out.
    if (!(error instanceof NativeApiError && error.status === 401)) remoteError = error;
  }

  await clearNativeSessionToken(serverUrl);
  if (remoteError) {
    const detail = remoteError instanceof Error ? remoteError.message : "network request failed";
    throw new Error(`Signed out on this device, but server revocation could not be confirmed: ${detail}`);
  }
}

async function authenticate(
  serverUrl: string,
  path: "/native/login" | "/native/register" | "/native/guest",
  body: Record<string, string>,
): Promise<NativeSession> {
  const response = await nativeRequest<AuthResponse>(serverUrl, path, { method: "POST", body });
  if (
    !isRecord(response) || response.ok !== true ||
    typeof response.sessionToken !== "string" || !/^[a-f\d]{64}$/i.test(response.sessionToken) ||
    !isNativeUser(response.user)
  ) {
    throw new NativeApiError(502, "The server returned an invalid authentication response.");
  }

  // Persist only after the response is validated; the plugin uses Keychain/Keystore on devices.
  await saveNativeSessionToken(serverUrl, response.sessionToken);
  return { token: response.sessionToken, user: response.user };
}

function isNativeUser(value: unknown): value is NativeUser {
  return isRecord(value) && Number.isSafeInteger(value.id) &&
    typeof value.username === "string" && typeof value.created_at === "number" &&
    (value.is_admin === 0 || value.is_admin === 1) &&
    (value.is_guest === 0 || value.is_guest === 1) &&
    (value.email === null || typeof value.email === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
