import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { parse } from "../validation.js";
import { closeUserSockets } from "../ws/hub.js";
import { requireAuth } from "./routes.js";
import { verifyPassword } from "./crypto.js";
import { DeletionBlocked, deleteAccount } from "./deletion.js";
import { getUserByUsername } from "./queries.js";
import { SESSION_COOKIE } from "./sessionToken.js";

// Guests have no password, so for them the signed-in session is the confirmation.
const DeleteAccountBody = z.object({ password: z.string().max(128).optional() });

export async function accountRoutes(app: FastifyInstance): Promise<void> {
  // POST rather than DELETE: some HTTP stacks (including the native app's) drop or mishandle a body on DELETE.
  app.post(
    "/api/me/delete",
    { preHandler: requireAuth, config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } },
    async (req, reply) => {
      const body = parse(DeleteAccountBody, req.body, reply);
      if (!body) return reply;
      const user = req.user!;

      if (!user.is_guest) {
        const stored = getUserByUsername(user.username);
        const ok = stored && body.password !== undefined && (await verifyPassword(body.password, stored.password_hash));
        if (!ok) {
          req.log.warn({ userId: user.id }, "account deletion: wrong password");
          return reply.code(403).send({ error: "Incorrect password" });
        }
      }

      try {
        if (!deleteAccount(user.id)) return reply.code(404).send({ error: "Account not found" });
      } catch (err) {
        if (err instanceof DeletionBlocked) return reply.code(409).send({ error: err.message });
        throw err;
      }

      closeUserSockets(user.id);
      // A browser session is a cookie we should clear; a native bearer session has none.
      if (req.headers.authorization === undefined) reply.clearCookie(SESSION_COOKIE, { path: "/", secure: config.cookieSecure });
      req.log.info({ userId: user.id }, "account deleted"); // the id only: the name is gone
      return { ok: true };
    },
  );
}
