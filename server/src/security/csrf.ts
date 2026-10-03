import type { FastifyInstance } from "fastify";
import { config } from "../config.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Shared by the HTTP hook below and the WebSocket upgrade check.
//  - No Origin header -> non-browser client (curl, scripts). Allowed: it still needs a valid session cookie.
//  - BASE_URL set     -> Origin must equal it exactly (also defeats DNS rebinding).
//  - BASE_URL unset   -> Origin's host must equal the Host header (dev, e.g. Vite proxy).
export function originAllowed(
  origin: string | undefined,
  host: string | undefined,
  baseOrigin: string | undefined = config.baseOrigin,
): boolean {
  if (!origin) return true;
  if (origin === "null") return false;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (baseOrigin) return parsed.origin === baseOrigin;
  return !!host && parsed.host === host;
}

// Defense in depth on top of SameSite=Lax: reject state-changing requests from other origins.
export function registerCsrfProtection(app: FastifyInstance): void {
  app.addHook("onRequest", async (req, reply) => {
    if (SAFE_METHODS.has(req.method)) return;
    if (req.headers["sec-fetch-site"] === "cross-site" || !originAllowed(req.headers.origin, req.headers.host)) {
      req.log.warn(
        {
          origin: req.headers.origin,
          host: req.headers.host,
          secFetchSite: req.headers["sec-fetch-site"],
          baseOrigin: config.baseOrigin,
        },
        "blocked cross-origin request",
      );
      return reply.code(403).send({ error: "Cross-origin request blocked" });
    }
  });
}