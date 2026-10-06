import type { FastifyInstance } from "fastify";
import { ForgotPasswordBody, ResetPasswordBody } from "@lilchess/shared";
import { parse } from "../validation.js";
import { emailEnabled, sendMail } from "../notifications/mailer.js";
import { passwordReset } from "../notifications/templates.js";
import { hashPassword, hashSessionToken } from "./crypto.js";
import { consumeResetToken, createResetToken, findResetTargets } from "./passwordReset.js";

export async function resetRoutes(app: FastifyInstance) {
  // Always 200 for a configured server, whether or not the account exists, so this can't be used
  // to discover usernames or emails.
  app.post(
    "/api/password/forgot",
    { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } },
    async (req, reply) => {
      const body = parse(ForgotPasswordBody, req.body, reply);
      if (!body) return reply;
      if (!emailEnabled()) {
        return reply.code(503).send({ error: "This server isn't set up to send email, so passwords can't be reset this way." });
      }
      for (const u of findResetTargets(body.identifier)) {
        const token = createResetToken(u.id);
        if (token) {
          const { subject, text } = passwordReset(u.username, token);
          void sendMail({ to: u.email, subject, text });
        }
      }
      return { ok: true };
    },
  );

  app.post(
    "/api/password/reset",
    { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } },
    async (req, reply) => {
      const body = parse(ResetPasswordBody, req.body, reply);
      if (!body) return reply;
      const ok = consumeResetToken(hashSessionToken(body.token), await hashPassword(body.password));
      if (!ok) return reply.code(400).send({ error: "This reset link is invalid or has expired" });
      return { ok: true };
    },
  );
}