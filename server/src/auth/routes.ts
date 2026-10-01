import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";
import { LoginBody, RegisterBody, parse } from "../validation.js";
import {
  burnPasswordCheck,
  generateSessionToken,
  hashPassword,
  hashSessionToken,
  safeEqual,
  verifyPassword,
} from "./crypto.js";
import { createSession, createUser, deleteSession, getSessionUser, getUserByUsername, type User } from "./queries.js";

export const SESSION_COOKIE = "sessionId";
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

declare module "fastify" {
  interface FastifyRequest {
    user?: User;
  }
}

export async function authRoutes(app: FastifyInstance) {
  // Global rate limiting is registered once in app.ts; routes below opt in to stricter limits.

  app.post(
    "/api/register",
    { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } },
    async (req, reply) => {
      if (config.registration === "closed") {
        return reply.code(403).send({ error: "Registration is closed" });
      }

      const body = parse(RegisterBody, req.body, reply);
      if (!body) return reply;

      if (config.registration === "invite" && !safeEqual(body.inviteCode ?? "", config.inviteCode ?? "")) {
        return reply.code(403).send({ error: "Invalid invite code" });
      }

      try {
        const user = createUser(body.username, await hashPassword(body.password));
        await establishSession(reply, user.id);
        req.log.info({ userId: user.id }, "user registered");
        return { ok: true, user };
      } catch (err) {
        if ((err as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE") {
          return reply.code(409).send({ error: "Username taken" });
        }
        throw err;
      }
    },
  );

  // 10 attempts per minute per IP
  app.post(
    "/api/login",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const body = parse(LoginBody, req.body, reply);
      if (!body) return reply;

      const user = getUserByUsername(body.username);
      const valid = user
        ? await verifyPassword(body.password, user.password_hash)
        : (await burnPasswordCheck(body.password), false);

      if (!user || !valid) {
        req.log.warn({ username: body.username }, "failed login");
        return reply.code(401).send({ error: "Invalid credentials" });
      }

      await establishSession(reply, user.id);
      const { password_hash: _omit, ...safeUser } = user;
      return { ok: true, user: safeUser };
    },
  );

  app.post("/api/logout", async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) deleteSession(hashSessionToken(token));
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/me", { preHandler: requireAuth }, async (req) => ({ user: req.user }));
}

async function establishSession(reply: FastifyReply, userId: number) {
  const token = generateSessionToken();
  createSession(hashSessionToken(token), userId, Date.now() + THIRTY_DAYS_MS);

  reply.setCookie(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: config.cookieSecure, // follows BASE_URL (https => Secure); falls back to NODE_ENV
    maxAge: THIRTY_DAYS_MS / 1000,
  });
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return reply.code(401).send({ error: "Unauthorized" });

  const user = getSessionUser(hashSessionToken(token));
  if (!user) {
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.code(401).send({ error: "Session expired" });
  }

  req.user = user;
}