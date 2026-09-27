import type { IncomingMessage } from "node:http";
import { SESSION_COOKIE } from "../auth/routes.js";
import { hashSessionToken } from "../auth/crypto.js";
import { getSessionUser, type User } from "../auth/queries.js";

function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
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
  const allowed = process.env.BASE_URL;
  if (!allowed) return true;
  return req.headers.origin === allowed;
}