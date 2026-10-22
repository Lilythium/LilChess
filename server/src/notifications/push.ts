import webpush from "web-push";
import { config } from "../config.js";
import { getDb } from "../db/connection.js";
import { logger } from "../logger.js";
import { removeSubscriptionByEndpoint, type PushSubscriptionRow } from "./queries.js";

const log = logger.child({ mod: "push" });

export interface PushPayload {
  title: string;
  body: string;
  /** Hash route to open on click, e.g. "/game/abc". The service worker prefixes it with "/#". */
  path: string;
  /** Notifications with the same tag replace each other on the device. */
  tag: string;
}

// Push services we accept subscription endpoints for. The server POSTs to whatever endpoint a user
// registers, so an open list would let any account make it send requests to arbitrary https hosts.
// A name matches itself and its subdomains. Operators can extend it with PUSH_ENDPOINT_HOSTS.
const BUILTIN_PUSH_HOSTS = [
  "fcm.googleapis.com", // Chrome, Edge, Brave, Opera, Samsung Internet
  "push.services.mozilla.com", // Firefox
  "push.apple.com", // Safari (web.push.apple.com)
  "notify.windows.com", // legacy Edge / WNS
];

export function isPushEndpoint(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return false;
  const host = u.hostname.toLowerCase();
  return [...BUILTIN_PUSH_HOSTS, ...config.pushExtraHosts].some((h) => host === h || host.endsWith(`.${h}`));
}

// The contact URL sent with every push. Production needs a real one (BASE_URL or PUSH_SUBJECT); the
// placeholder only exists so `npm run dev` works without configuration.
function subject(): string | undefined {
  return config.pushSubject ?? config.baseOrigin ?? (config.nodeEnv === "production" ? undefined : "mailto:dev@localhost.invalid");
}

export function pushEnabled(): boolean {
  return config.pushEnabled && subject() !== undefined;
}

interface Vapid { publicKey: string; privateKey: string }

// Generated the first time push is used and kept in the database, so backups carry the keys that the
// stored subscriptions were created against. INSERT OR IGNORE makes a concurrent first use harmless.
export function vapidKeys(): Vapid {
  const db = getDb();
  const read = () =>
    db.prepare(`SELECT public_key AS publicKey, private_key AS privateKey FROM push_vapid WHERE id = 1`).get() as Vapid | undefined;
  const existing = read();
  if (existing) return existing;
  const fresh = webpush.generateVAPIDKeys();
  db.prepare(`INSERT OR IGNORE INTO push_vapid (id, public_key, private_key) VALUES (1, ?, ?)`).run(fresh.publicKey, fresh.privateKey);
  return read()!;
}

const MAX_BODY = 200;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Sends one payload to each of a user's devices. Never throws. A subscription the push service reports
 * gone (404/410) is deleted so we stop trying it. Resolves to how many devices accepted the message.
 */
export async function sendPush(subs: PushSubscriptionRow[], payload: PushPayload): Promise<number> {
  const sub = subject();
  if (!config.pushEnabled || !sub || subs.length === 0) return 0;
  const { publicKey, privateKey } = vapidKeys();
  const body = JSON.stringify({ ...payload, title: clip(payload.title, 100), body: clip(payload.body, MAX_BODY) });

  const results = await Promise.allSettled(
    subs.map((s) =>
      webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, {
        vapidDetails: { subject: sub, publicKey, privateKey },
        TTL: 24 * 60 * 60,
        urgency: "normal",
        timeout: 5_000,
      }),
    ),
  );

  let sent = 0;
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      sent++;
      return;
    }
    const status = (r.reason as { statusCode?: number } | undefined)?.statusCode;
    const endpoint = subs[i]!.endpoint;
    if (status === 404 || status === 410) {
      removeSubscriptionByEndpoint(endpoint);
    } else {
      // Log the push service's host, never the endpoint itself: the URL is the capability to message the device.
      log.warn({ status, host: new URL(endpoint).hostname }, "push delivery failed");
    }
  });
  return sent;
}
