import type { FastifyInstance } from "fastify";
import { NotificationSettingsBody, PushEndpointBody, PushSubscriptionBody, UnsubscribeBody } from "@lilchess/shared";
import { requireAuth } from "../auth/routes.js";
import { parse } from "../validation.js";
import { discordEnabled } from "./discord.js";
import { emailEnabled } from "./mailer.js";
import { isPushEndpoint, pushEnabled, sendPush, vapidKeys } from "./push.js";
import {
  getPrefs, getUserDiscordId, getUserEmail, listSubscriptions, removeSubscription, saveSubscription, setPrefs,
  setUserDiscordId, setUserEmail, unsubscribeByToken,
} from "./queries.js";

export async function notificationRoutes(app: FastifyInstance) {
  const current = (userId: number) => ({
    ok: true,
    emailAvailable: emailEnabled(), // false = the server has no SMTP, so nothing will be sent
    email: getUserEmail(userId),
    prefs: getPrefs(userId),
    discordAvailable: discordEnabled(), // false = the server has no Discord webhook, so nothing will be sent
    discordId: getUserDiscordId(userId),
    discordPrefs: getPrefs(userId, "discord"),
    pushAvailable: pushEnabled(), // false = push is switched off, or production has no BASE_URL / PUSH_SUBJECT
    pushPublicKey: pushEnabled() ? vapidKeys().publicKey : null, // the browser needs it to subscribe
    pushDevices: listSubscriptions(userId).length,
    pushPrefs: getPrefs(userId, "push"),
  });

  app.get("/api/me/notifications", { preHandler: requireAuth }, async (req) => current(req.user!.id));

  app.put("/api/me/notifications", { preHandler: requireAuth }, async (req, reply) => {
    if (req.user!.is_guest) {
      return reply.code(403).send({ error: "Guests can't set an email or Discord ID. Register an account first." });
    }
    const body = parse(NotificationSettingsBody, req.body, reply);
    if (!body) return reply;
    if (body.email !== undefined) setUserEmail(req.user!.id, body.email || null);
    if (body.prefs) setPrefs(req.user!.id, body.prefs);
    if (body.discordId !== undefined) setUserDiscordId(req.user!.id, body.discordId || null);
    if (body.discordPrefs) setPrefs(req.user!.id, body.discordPrefs, "discord");
    if (body.pushPrefs) setPrefs(req.user!.id, body.pushPrefs, "push");
    return current(req.user!.id);
  });

  // ---- Web Push: one subscription per browser the user turned notifications on in ----

  const pushGuard = (req: { user?: { is_guest: number } }, reply: { code(n: number): { send(b: object): unknown } }) => {
    if (!pushEnabled()) return reply.code(503).send({ error: "Push notifications aren't available on this server" });
    if (req.user!.is_guest) return reply.code(403).send({ error: "Guests can't turn on notifications. Register an account first." });
    return undefined;
  };

  app.post(
    "/api/me/push-subscription",
    { preHandler: requireAuth, config: { rateLimit: { max: 30, timeWindow: "1 hour" } } },
    async (req, reply) => {
      if (pushGuard(req, reply)) return reply;
      const body = parse(PushSubscriptionBody, req.body, reply);
      if (!body) return reply;
      if (!isPushEndpoint(body.endpoint)) {
        return reply.code(400).send({ error: "This browser's push service isn't supported by this server" });
      }
      saveSubscription(req.user!.id, { endpoint: body.endpoint, p256dh: body.keys.p256dh, auth: body.keys.auth });
      return current(req.user!.id);
    },
  );

  // Works even if push has since been switched off, so people can always clean up their devices.
  app.delete("/api/me/push-subscription", { preHandler: requireAuth }, async (req, reply) => {
    const body = parse(PushEndpointBody, req.body, reply);
    if (!body) return reply;
    removeSubscription(req.user!.id, body.endpoint);
    return current(req.user!.id);
  });

  // "Send me a test": goes to all of the user's devices, ignoring per-kind toggles.
  app.post(
    "/api/me/push-test",
    { preHandler: requireAuth, config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (req, reply) => {
      if (pushGuard(req, reply)) return reply;
      const subs = listSubscriptions(req.user!.id);
      if (subs.length === 0) return reply.code(409).send({ error: "No device is registered for notifications yet" });
      const sent = await sendPush(subs, {
        title: "LilChess test notification",
        body: "Notifications are working on this device.",
        path: "/settings",
        tag: "push-test",
      });
      return { ok: true, sent, devices: subs.length };
    },
  );

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