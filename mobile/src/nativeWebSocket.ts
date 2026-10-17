import { NativeApiError, nativeRequest } from "./nativeApi.js";
import { normalizeServerAddress } from "./serverSelection.js";

export const NATIVE_WS_SUBPROTOCOL = "lilchess.v1";
const TICKET_PROTOCOL_PREFIX = "lilchess-ticket.";

/** Tickets are 32 random bytes encoded as unpadded base64url. */
export function nativeWebSocketProtocols(ticket: string): string[] {
  if (!/^[A-Za-z0-9_-]{43}$/.test(ticket)) {
    throw new TypeError("The server returned an invalid WebSocket ticket.");
  }
  // The static protocol is first, and the server explicitly echoes only this value. The ticket
  // itself is presented in the handshake header, never in a URL, and is not echoed back.
  return [NATIVE_WS_SUBPROTOCOL, `${TICKET_PROTOCOL_PREFIX}${ticket}`];
}

export function nativeWebSocketUrl(serverUrl: string, path: string): string {
  if (!/^\/ws\/(?:me|games\/[a-f\d]{8,16}|simuls\/[a-f\d]{8,16})$/i.test(path)) {
    throw new TypeError("Unsupported LilChess WebSocket path.");
  }
  return `${normalizeServerAddress(serverUrl).wsBaseUrl}${path}`;
}

type NativeWebSocketFactory = (url: string, protocols: string[]) => WebSocket;

/** Obtain a ticket over authenticated HTTPS/native HTTP and open the corresponding WebSocket. */
export async function connectNativeWebSocket(
  serverUrl: string,
  sessionToken: string,
  path: string,
  createSocket: NativeWebSocketFactory = (url, protocols) => new WebSocket(url, protocols),
): Promise<WebSocket> {
  const response = await nativeRequest<{ ok: boolean; ticket: string }>(
    serverUrl,
    "/native/ws-ticket",
    { method: "POST", token: sessionToken },
  );
  if (response.ok !== true || typeof response.ticket !== "string") {
    throw new NativeApiError(502, "The server returned an invalid WebSocket ticket response.");
  }
  return createSocket(nativeWebSocketUrl(serverUrl, path), nativeWebSocketProtocols(response.ticket));
}
