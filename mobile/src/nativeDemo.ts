import { NativeApiError, nativeRequest } from "./nativeApi.js";
import { saveNativeSessionToken } from "./secureSession.js";
import { isNativeUser, type NativeSession, type NativeUser } from "./nativeAuth.js";

interface DemoResponse {
  ok: true;
  user: NativeUser;
  sessionToken: string;
  gameId: string;
}

/**
 * Starts a demo game on a server that advertises `features.demo`: a guest session plus a game against the
 * practice bot, with no account and no invite link. The session is stored like any other (per server, in secure
 * storage) and the caller opens `gameId`. A server without demo mode answers 404, which is reported as such.
 */
export async function startDemoGame(serverUrl: string): Promise<{ session: NativeSession; gameId: string }> {
  const response = await nativeRequest<DemoResponse>(serverUrl, "/native/demo", { method: "POST" });
  if (
    !isRecord(response) || response.ok !== true ||
    typeof response.sessionToken !== "string" || !/^[a-f\d]{64}$/i.test(response.sessionToken) ||
    typeof response.gameId !== "string" || !/^[a-f\d]{8,16}$/i.test(response.gameId) ||
    !isNativeUser(response.user)
  ) {
    throw new NativeApiError(502, "The server returned an invalid demo response.");
  }
  await saveNativeSessionToken(serverUrl, response.sessionToken);
  return { session: { token: response.sessionToken, user: response.user }, gameId: response.gameId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
