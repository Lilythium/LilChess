import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";
import { GuestBody, LoginBody, RegisterBody, parse } from "../validation.js"; 
import {
  burnPasswordCheck,
  generateSessionToken,
  hashPassword,
  hashSessionToken,
  safeEqual,
  verifyPassword,
} from "./crypto.js";
import { createGuest, createSession, createUser, deleteSession, getSessionUser, getUserByUsername, type User } from "./queries.js";
import { getInvitePreview } from "../game/queries.js";   
import { consumeRegistrationInvite, isRegistrationInviteUsable } from "./invites.js";
import { getDb } from "../db/connection.js";

export const SESSION_COOKIE = "sessionId";
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const GUEST_SESSION_MS = 365 * 24 * 60 * 60 * 1000;

declare module "fastify" {
  interface FastifyRequest {
    user?: User;
  }
}

class InviteUsedUp extends Error {}

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

            // In invite mode the code is either the INVITE_CODE from the environment or one an admin created.
      const code = body.inviteCode ?? "";
      const envCode = config.registration === "invite" && !!config.inviteCode && safeEqual(code, config.inviteCode);
      if (config.registration === "invite" && !envCode && !isRegistrationInviteUsable(code)) {
        return reply.code(403).send({ error: "Invalid invite code" });
      }

      try {
        const passwordHash = await hashPassword(body.password);
        // Using up a code and creating the account succeed or fail together: a taken username costs no invite.
        const user = getDb().transaction(() => {
          if (config.registration === "invite" && !envCode && !consumeRegistrationInvite(code)) throw new InviteUsedUp();
          return createUser(body.username, passwordHash);
        }).immediate();
        await establishSession(reply, user.id);
        req.log.info({ userId: user.id }, "user registered");
        return { ok: true, user };
      } catch (err) {
        if (err instanceof InviteUsedUp) return reply.code(403).send({ error: "Invalid invite code" });
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
      const valid =
        user && !user.is_guest
          ? await verifyPassword(body.password, user.password_hash)
          : (await burnPasswordCheck(body.password), false);

      if (!user || !valid) {
        req.log.warn({ username: body.username }, "failed login");
        return reply.code(401).send({ error: "Invalid credentials" });
      }

      // Only said after the password checked out, so it doesn't reveal which usernames exist.
      if (user.disabled_at !== null) {
        req.log.warn({ userId: user.id }, "login to a disabled account");
        return reply.code(403).send({ error: "This account has been disabled. Contact the server administrator." });
      }

      await establishSession(reply, user.id);
      const { password_hash: _omit, disabled_at: _disabled, ...safeUser } = user;
      return { ok: true, user: safeUser };
    },
  );

  // Guests exist only to play via an invite link: a valid link is required to get one.
  app.post(
    "/api/guest",
    { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } },
    async (req, reply) => {
      if (!config.allowGuests || config.registration === "closed") {
        return reply.code(403).send({ error: "Guest play is disabled on this server" });
      }
      const body = parse(GuestBody, req.body, reply);
      if (!body) return reply;
      const invite = getInvitePreview(body.challengeId);
      if (!invite) {
        return reply.code(404).send({ error: "This invite link is invalid or has expired" });
      }
      if (invite.targeted) {
        return reply.code(403).send({ error: "This challenge is for a specific player. Log in or register to accept it." });
      }

      const user = createGuest();
      await establishSession(reply, user.id, GUEST_SESSION_MS);
      req.log.info({ userId: user.id }, "guest created");
      return { ok: true, user };
    },
  );

  app.post("/api/logout", async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) deleteSession(hashSessionToken(token));
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

    app.get("/api/me", { preHandler: requireAuth }, async (req) => ({ ok: true, user: req.user }));
}

async function establishSession(reply: FastifyReply, userId: number, maxAgeMs = THIRTY_DAYS_MS) {
  const token = generateSessionToken();
  createSession(hashSessionToken(token), userId, Date.now() + maxAgeMs);

  reply.setCookie(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: config.cookieSecure,
    maxAge: maxAgeMs / 1000,
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

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  await requireAuth(req, reply);
  if (reply.sent) return;
  if (!req.user?.is_admin) return reply.code(403).send({ error: "Administrator access required" });
}