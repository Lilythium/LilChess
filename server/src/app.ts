import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import fs from "node:fs";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { authRoutes } from "./auth/routes.js";
import { gameRoutes } from "./game/routes.js";
import { attachWebSocketServer } from "./ws/server.js";
import { registerCsrfProtection } from "./security/csrf.js";

type TrustProxy = boolean | string | ((address: string, hop: number) => boolean);

function toTrustProxy(tp: boolean | number | string): TrustProxy {
  return typeof tp === "number" ? (_address, hop) => hop < tp : tp;
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: logger as FastifyBaseLogger,
    trustProxy: toTrustProxy(config.trustProxy),
    bodyLimit: 16 * 1024,
    requestTimeout: 15_000,
  });

  await app.register(cookie);

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

  app.setErrorHandler((err, req, reply) => {
    const e = (typeof err === "object" && err !== null ? err : {}) as { statusCode?: unknown; message?: unknown };
    const status = typeof e.statusCode === "number" && e.statusCode >= 400 ? e.statusCode : 500;
    const message = typeof e.message === "string" ? e.message : "Bad request";

    if (status >= 500) req.log.error({ err }, "request failed");
    void reply.code(status).send({ error: status >= 500 ? "Internal server error" : message });
  });

  // API Routes
  await app.register(authRoutes);
  await app.register(gameRoutes);
  app.get("/api/health", { config: { rateLimit: false } }, async () => ({ ok: true }));

  // Static Assets Serving (web/dist)
  const webDistPath = path.resolve(process.cwd(), "web/dist");
  if (fs.existsSync(webDistPath)) {
    await app.register(fastifyStatic, {
      root: webDistPath,
      prefix: "/",
      wildcard: false,
    });

    // SPA Fallback: Route non-API GET requests to index.html
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api") && !req.url.startsWith("/ws")) {
        return reply.sendFile("index.html");
      }
      return reply.status(404).send({ error: "Not Found", statusCode: 404 });
    });
  }

  attachWebSocketServer(app);
  return app;
}