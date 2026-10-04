import type { IncomingMessage } from "node:http";
import { SESSION_COOKIE } from "../auth/routes.js";
import { hashSessionToken } from "../auth/crypto.js";
import { getSessionUser, type User } from "../auth/queries.js";
import { originAllowed } from "../security/csrf.js";

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
  const token = parseCookie(req.headers.cookie, SESSION_COOKIE);
  if (!token) return undefined;
  return getSessionUser(hashSessionToken(token));
}

export function isAllowedOrigin(req: IncomingMessage): boolean {
  return originAllowed(req.headers.origin, req.headers.host);
}