import type { IncomingMessage } from "node:http";
import { SESSION_COOKIE, sessionTokenFromCredentials } from "../auth/sessionToken.js";
import { hashSessionToken } from "../auth/crypto.js";
import { getSessionUser, type User } from "../auth/queries.js";
import { consumeNativeWebSocketTicket, hasNativeWebSocketTicket } from "../auth/nativeWebSocketTicket.js";
import { originAllowed } from "../security/csrf.js";

const NATIVE_WEBSOCKET_PROTOCOL = "lilchess.v1";
const NATIVE_TICKET_PREFIX = "lilchess-ticket.";
// These are the exact origins pinned in mobile/capacitor.config.ts. Do not add a wildcard.
const CAPACITOR_ORIGINS = new Set(["capacitor://localhost", "https://localhost"]);

function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export function authenticateUpgrade(req: IncomingMessage): User | undefined {
  const token = sessionTokenFromCredentials(req.headers.authorization, parseCookie(req.headers.cookie, SESSION_COOKIE));
  if (!token) return undefined;
  return getSessionUser(hashSessionToken(token));
}

/** Extract a well-formed ticket only when the stable protocol is also requested. */
export function nativeWebSocketTicketFromHeader(
  header: string | string[] | undefined,
): string | undefined {
  const values = (Array.isArray(header) ? header : header ? [header] : [])
    .flatMap((value) => value.split(","))
    .map((value) => value.trim());
  const ticketProtocols = values.filter((value) => value.startsWith(NATIVE_TICKET_PREFIX));
  if (!values.includes(NATIVE_WEBSOCKET_PROTOCOL) || ticketProtocols.length !== 1) return undefined;
  const ticket = ticketProtocols[0]!.slice(NATIVE_TICKET_PREFIX.length);
  return /^[A-Za-z0-9_-]{43}$/.test(ticket) ? ticket : undefined;
}

export function authenticateNativeWebSocketTicket(ticket: string): User | undefined {
  const sessionTokenHash = consumeNativeWebSocketTicket(ticket);
  return sessionTokenHash ? getSessionUser(sessionTokenHash) : undefined;
}

export function isValidNativeWebSocketTicket(ticket: string): boolean {
  return hasNativeWebSocketTicket(ticket);
}

export function isAllowedOrigin(req: IncomingMessage, validNativeTicket = false): boolean {
  const origin = req.headers.origin;
  if (validNativeTicket && origin && CAPACITOR_ORIGINS.has(origin)) return true;
  return originAllowed(origin, req.headers.host);
}