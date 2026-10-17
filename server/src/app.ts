import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import fs from "node:fs";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { attachWebSocketServer } from "./ws/server.js";
import { registerCsrfProtection } from "./security/csrf.js";
import { authRoutes } from "./auth/routes.js";
import { resetRoutes } from "./auth/resetRoutes.js";
import { gameRoutes } from "./game/routes.js";
import { notificationRoutes } from "./notifications/routes.js";
import { adminRoutes } from "./admin/routes.js";
import { tournamentRoutes } from "./tournaments/routes.js";
import { leaderboardRoutes } from "./leaderboard/routes.js";
import { openingsRoutes } from "./openings/routes.js";
import { importedRoutes } from "./imported/routes.js";
import { simulRoutes } from "./simuls/routes.js";

// Keep the health version tied to the root package version used for server releases. This path
// resolves to the repository root from both server/src during development and server/dist at runtime.
const rootPackage = JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };
const SERVER_API_VERSION = 1; // See docs/mobile-phase-0-review.md for the compatibility policy.

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
  await app.register(resetRoutes);
  await app.register(gameRoutes);
  await app.register(notificationRoutes);
  await app.register(adminRoutes);
  await app.register(tournamentRoutes);
  await app.register(leaderboardRoutes);
  await app.register(openingsRoutes);
  await app.register(importedRoutes);
  await app.register(simulRoutes);
  app.get("/api/health", { config: { rateLimit: false } }, async () => ({
    ok: true,
    app: "lilchess",
    version: rootPackage.version,
    apiVersion: SERVER_API_VERSION,
    features: {
      guests: config.allowGuests,
      registration: config.registration,
    },
  }));

  // Static assets (web/dist) + SPA fallback
  const webDistPath = path.resolve(process.cwd(), "web/dist");
  const hasWeb = fs.existsSync(webDistPath);
  if (hasWeb) {
    await app.register(fastifyStatic, {
      root: webDistPath,
      prefix: "/",
      wildcard: false,
      // The engine's file name carries its version, so it can be cached for a year.
      setHeaders: (reply, filePath) => {
        if (filePath.includes(`${path.sep}stockfish${path.sep}`)) {
          reply.header("cache-control", "public, max-age=31536000, immutable");
        }
      },
    });
  }

  app.setNotFoundHandler((req, reply) => {
    if (hasWeb && req.method === "GET" && !req.url.startsWith("/api") && !req.url.startsWith("/ws")) {
      return reply.sendFile("index.html");
    }
    return reply.code(404).send({ error: "Not found" });
  });

  attachWebSocketServer(app);
  return app;
}