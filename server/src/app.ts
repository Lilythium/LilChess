import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { authRoutes } from "./auth/routes.js";
import { gameRoutes } from "./game/routes.js";
import { attachWebSocketServer } from "./ws/server.js";
import { registerCsrfProtection } from "./security/csrf.js";

// Fastify's types don't accept a bare hop count, so turn N into a trust function.
// proxy-addr calls it with hop 0 = the socket peer, hop 1 = the next X-Forwarded-For entry, and so on.
// TRUST_PROXY=1 therefore trusts exactly one proxy (Caddy/Traefik).
type TrustProxy = boolean | string | ((address: string, hop: number) => boolean);

function toTrustProxy(tp: boolean | number | string): TrustProxy {
  return typeof tp === "number" ? (_address, hop) => hop < tp : tp;
}

// Builds the HTTP app without opening the DB, starting schedulers, or listening,
// so tests can use app.inject().
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    // CHANGED: cast so the app type is FastifyInstance<..., FastifyBaseLogger> instead of pino's concrete Logger<...>
    loggerInstance: logger as FastifyBaseLogger,
    trustProxy: toTrustProxy(config.trustProxy),
    bodyLimit: 16 * 1024, // every JSON body here is tiny
    requestTimeout: 15_000, // slow-loris protection
  });

  await app.register(cookie);

  // Global per-IP limit (the UI polls, so keep it generous); sensitive routes opt in to stricter limits.
  await app.register(rateLimit, {
    global: true,
    max: 600,
    timeWindow: "1 minute",
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      error: "Too Many Requests",
      message: `Too many requests, try again in ${ctx.after}`,
    }),
  });

  registerCsrfProtection(app);

  // CHANGED: `err` is `unknown` in Fastify 5, and may be a plain object (rate-limit) rather than an Error.
  app.setErrorHandler((err, req, reply) => {
    const e = (typeof err === "object" && err !== null ? err : {}) as { statusCode?: unknown; message?: unknown };
    const status = typeof e.statusCode === "number" && e.statusCode >= 400 ? e.statusCode : 500;
    const message = typeof e.message === "string" ? e.message : "Bad request";

    if (status >= 500) req.log.error({ err }, "request failed");
    void reply.code(status).send({ error: status >= 500 ? "Internal server error" : message });
  });

  await app.register(authRoutes);
  await app.register(gameRoutes);

  app.get("/api/health", { config: { rateLimit: false } }, async () => ({ ok: true }));

  attachWebSocketServer(app);
  return app;
}