import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { hashPassword, verifyPassword, generateSessionToken, hashSessionToken } from "./crypto.js";
import { createUser, getUserByUsername, createSession, getSessionUser, deleteSession, User } from "./queries.js";

const SESSION_COOKIE = "sessionId";
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// Augment FastifyRequest so TS knows req.user exists
declare module "fastify" {
  interface FastifyRequest {
    user?: User;
  }
}

export async function authRoutes(app: FastifyInstance) {
  
  // Login with rate limiting (max 5 attempts per minute per IP)
  app.register(import('@fastify/rate-limit'), {
    max: 5,
    timeWindow: '1 minute'
  });

  app.post("/api/register", async (req, reply) => {
    const { username, password, inviteCode } = req.body as any;
    
    if (!username || !password || password.length < 8) {
      return reply.code(400).send({ error: "Invalid username or password too short" });
    }

    const regMode = process.env.REGISTRATION || "open";
    if (regMode === "closed") {
      return reply.code(403).send({ error: "Registration is closed" });
    }
    if (regMode === "invite" && inviteCode !== process.env.INVITE_CODE) {
      return reply.code(403).send({ error: "Invalid invite code" });
    }

    try {
      const hash = await hashPassword(password);
      const user = createUser(username, hash);
      await establishSession(reply, user.id);
      return { ok: true, user };
    } catch (err: any) {
      if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
        return reply.code(409).send({ error: "Username taken" });
      }
      throw err;
    }
  });

  app.post("/api/login", async (req, reply) => {
    const { username, password } = req.body as any;
    const user = getUserByUsername(username);

    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return reply.code(401).send({ error: "Invalid credentials" });
    }

    await establishSession(reply, user.id);
    const { password_hash, ...safeUser } = user;
    return { ok: true, user: safeUser };
  });

  app.post("/api/logout", async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) {
      deleteSession(hashSessionToken(token));
    }
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  // Protected route example
  app.get("/api/me", { preHandler: requireAuth }, async (req) => {
    return { user: req.user };
  });
}

// Helper to set up the DB session and attach the cookie
async function establishSession(reply: FastifyReply, userId: number) {
  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = Date.now() + THIRTY_DAYS_MS;
  
  createSession(tokenHash, userId, expiresAt);
  
  reply.setCookie(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: THIRTY_DAYS_MS / 1000 // maxAge is in seconds
  });
}

// Middleware you can reuse on any route that requires a logged-in user
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