import type { FastifyInstance } from "fastify";
import { NotificationSettingsBody, UnsubscribeBody } from "@lilchess/shared";
import { requireAuth } from "../auth/routes.js";
import { parse } from "../validation.js";
import { emailEnabled } from "./mailer.js";
import { getPrefs, getUserEmail, setPrefs, setUserEmail, unsubscribeByToken } from "./queries.js";

export async function notificationRoutes(app: FastifyInstance) {
  const current = (userId: number) => ({
    ok: true,
    emailAvailable: emailEnabled(), // false = the server has no SMTP, so nothing will be sent
    email: getUserEmail(userId),
    prefs: getPrefs(userId),
  });

  app.get("/api/me/notifications", { preHandler: requireAuth }, async (req) => current(req.user!.id));

  app.put("/api/me/notifications", { preHandler: requireAuth }, async (req, reply) => {
    if (req.user!.is_guest) {
      return reply.code(403).send({ error: "Guests can't set an email. Register an account first." });
    }
    const body = parse(NotificationSettingsBody, req.body, reply);
    if (!body) return reply;
    if (body.email !== undefined) setUserEmail(req.user!.id, body.email || null);
    if (body.prefs) setPrefs(req.user!.id, body.prefs);
    return current(req.user!.id);
  });

  // No session needed: the token in the email link is the credential. Only turns emails off.
  app.post(
    "/api/unsubscribe",
    { config: { rateLimit: { max: 20, timeWindow: "1 hour" } } },
    async (req, reply) => {
      const body = parse(UnsubscribeBody, req.body, reply);
      if (!body) return reply;
      if (!unsubscribeByToken(body.token)) return reply.code(404).send({ error: "This link is no longer valid" });
      return { ok: true };
    },
  );
}