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
import { isDeletedUsername } from "@lilchess/shared";   
import { consumeRegistrationInvite, isRegistrationInviteUsable } from "./invites.js";
import { getDb } from "../db/connection.js";
import { SESSION_COOKIE, sessionTokenFromCredentials } from "./sessionToken.js";
import { issueNativeWebSocketTicket, NATIVE_WEBSOCKET_TICKET_TTL_MS } from "./nativeWebSocketTicket.js";

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

  const register = (nativeClient: boolean) => async (req: FastifyRequest, reply: FastifyReply) => {
    if (config.registration === "closed") {
      return reply.code(403).send({ error: "Registration is closed" });
    }

    const body = parse(RegisterBody, req.body, reply);
    if (!body) return reply;
    // The shape deleted accounts are renamed to. Treated like any taken name, so nothing is revealed.
    if (isDeletedUsername(body.username)) return reply.code(409).send({ error: "Username taken" });

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
      const sessionToken = await establishSession(reply, user.id, THIRTY_DAYS_MS, !nativeClient);
      req.log.info({ userId: user.id }, "user registered");
      return nativeClient ? { ok: true, user, sessionToken } : { ok: true, user };
    } catch (err) {
      if (err instanceof InviteUsedUp) return reply.code(403).send({ error: "Invalid invite code" });
      if ((err as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE") {
        return reply.code(409).send({ error: "Username taken" });
      }
      throw err;
    }
  };

  const registrationRateLimit = { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } };
  app.post("/api/register", registrationRateLimit, register(false));
  app.post("/api/native/register", registrationRateLimit, register(true));

  // 10 attempts per minute per IP
  const login = (nativeClient: boolean) => async (req: FastifyRequest, reply: FastifyReply) => {
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

    const sessionToken = await establishSession(reply, user.id, THIRTY_DAYS_MS, !nativeClient);
    const { password_hash: _omit, disabled_at: _disabled, ...safeUser } = user;
    return nativeClient ? { ok: true, user: safeUser, sessionToken } : { ok: true, user: safeUser };
  };

  const loginRateLimit = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };
  app.post("/api/login", loginRateLimit, login(false));
  app.post("/api/native/login", loginRateLimit, login(true));

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

  // Native guests use the same invite and permission checks as web guests, but receive a bearer
  // token and never depend on a WebView cookie jar.
  app.post(
    "/api/native/guest",
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
      const sessionToken = await establishSession(reply, user.id, GUEST_SESSION_MS, false);
      req.log.info({ userId: user.id }, "native guest created");
      return { ok: true, user, sessionToken };
    },
  );

  // A ticket is issued only from a validated native bearer session; cookies alone are not enough.
  app.post("/api/native/ws-ticket", {
    preHandler: requireAuth,
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
  }, async (req, reply) => {
    const token = sessionTokenFromCredentials(req.headers.authorization, undefined);
    if (!token) return reply.code(401).send({ error: "Native bearer authentication required" });
    try {
      const ticket = issueNativeWebSocketTicket(hashSessionToken(token));
      return { ok: true, ticket, expiresInMs: NATIVE_WEBSOCKET_TICKET_TTL_MS };
    } catch {
      req.log.warn({ userId: req.user?.id }, "native WebSocket ticket capacity reached");
      return reply.code(503).send({ error: "Unable to issue a WebSocket ticket. Try again shortly." });
    }
  });

  app.post("/api/logout", async (req, reply) => {
    const token = sessionTokenFromCredentials(req.headers.authorization, req.cookies[SESSION_COOKIE]);
    if (token) deleteSession(hashSessionToken(token));
    // Preserve web cookie logout; native bearer logout does not create or clear a browser cookie.
    if (req.headers.authorization === undefined) reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

    app.get("/api/me", { preHandler: requireAuth }, async (req) => ({ ok: true, user: req.user }));
}

async function establishSession(reply: FastifyReply, userId: number, maxAgeMs = THIRTY_DAYS_MS, setCookie = true) {
  const token = generateSessionToken();
  createSession(hashSessionToken(token), userId, Date.now() + maxAgeMs);

  if (setCookie) {
    reply.setCookie(SESSION_COOKIE, token, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: config.cookieSecure,
      maxAge: maxAgeMs / 1000,
    });
  }
  return token;
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const token = sessionTokenFromCredentials(req.headers.authorization, req.cookies[SESSION_COOKIE]);
  if (!token) return reply.code(401).send({ error: "Unauthorized" });

  const user = getSessionUser(hashSessionToken(token));
  if (!user) {
    if (req.headers.authorization === undefined) reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.code(401).send({ error: "Session expired" });
  }

  req.user = user;
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  await requireAuth(req, reply);
  if (reply.sent) return;
  if (!req.user?.is_admin) return reply.code(403).send({ error: "Administrator access required" });
}