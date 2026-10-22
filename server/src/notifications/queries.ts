import { randomBytes } from "node:crypto";
import { NOTIFICATION_KINDS, type NotificationKind } from "@lilchess/shared";
import { getDb } from "../db/connection.js";

export type Prefs = Record<NotificationKind, boolean>;

export interface Recipient {
  id: number;
  username: string;
  email: string;
  unsubscribeToken: string | null;
}

export function getUserEmail(userId: number): string | null {
  const row = getDb().prepare(`SELECT email FROM users WHERE id = ?`).get(userId) as { email: string | null } | undefined;
  return row?.email ?? null;
}

// Passing null removes the address (and its unsubscribe token).
export function setUserEmail(userId: number, email: string | null): void {
  getDb()
    .prepare(
      `UPDATE users SET email = @email,
         unsubscribe_token = CASE WHEN @email IS NULL THEN NULL ELSE COALESCE(unsubscribe_token, @token) END
       WHERE id = @id`,
    )
    .run({ id: userId, email, token: randomBytes(16).toString("hex") });
}

export type Channel = "email" | "discord" | "push";
const PREF_TABLE: Record<Channel, string> = {
  email: "notification_prefs",
  discord: "notification_prefs_discord",
  push: "notification_prefs_push",
};

export function getPrefs(userId: number, channel: Channel = "email"): Prefs {
  const prefs = Object.fromEntries(NOTIFICATION_KINDS.map((k) => [k, true])) as Prefs;
  const rows = getDb()
    .prepare(`SELECT kind, enabled FROM ${PREF_TABLE[channel]} WHERE user_id = ?`)
    .all(userId) as { kind: string; enabled: number }[];
  for (const r of rows) if (r.kind in prefs) prefs[r.kind as NotificationKind] = r.enabled === 1;
  return prefs;
}

export function setPrefs(userId: number, changes: Partial<Prefs>, channel: Channel = "email"): void {
  const db = getDb();
  const upsert = db.prepare(
    `INSERT INTO ${PREF_TABLE[channel]} (user_id, kind, enabled) VALUES (?, ?, ?)
     ON CONFLICT(user_id, kind) DO UPDATE SET enabled = excluded.enabled`,
  );
  db.transaction(() => {
    for (const [kind, enabled] of Object.entries(changes)) {
      if (enabled !== undefined) upsert.run(userId, kind, enabled ? 1 : 0);
    }
  })();
}

// Who should get this kind of email? Undefined: no address, a guest, a disabled account, or they turned it off.
export function recipientFor(userId: number, kind: NotificationKind): Recipient | undefined {
  const row = getDb()
    .prepare(`SELECT id, username, email, unsubscribe_token FROM users WHERE id = ? AND email IS NOT NULL AND is_guest = 0 AND disabled_at IS NULL`)
    .get(userId) as { id: number; username: string; email: string; unsubscribe_token: string | null } | undefined;
  if (!row || !getPrefs(userId)[kind]) return undefined;
  return { id: row.id, username: row.username, email: row.email, unsubscribeToken: row.unsubscribe_token };
}

// True exactly once per (user, key): the caller that gets true sends the email.
export function claimNotification(userId: number, dedupKey: string, kind: NotificationKind): boolean {
  return (
    getDb()
      .prepare(`INSERT OR IGNORE INTO notification_log (user_id, dedup_key, kind, created_at) VALUES (?, ?, ?, ?)`)
      .run(userId, dedupKey, kind, Date.now()).changes === 1
  );
}

export function unsubscribeByToken(token: string): boolean {
  const row = getDb().prepare(`SELECT id FROM users WHERE unsubscribe_token = ?`).get(token) as { id: number } | undefined;
  if (!row) return false;
  setPrefs(row.id, Object.fromEntries(NOTIFICATION_KINDS.map((k) => [k, false])) as Prefs);
  return true;
}

// ---- Discord ----

export function getUserDiscordId(userId: number): string | null {
  const row = getDb().prepare(`SELECT discord_id FROM users WHERE id = ?`).get(userId) as { discord_id: string | null } | undefined;
  return row?.discord_id ?? null;
}

// Passing null opts out: the ID is dropped and nothing more is sent.
export function setUserDiscordId(userId: number, discordId: string | null): void {
  getDb().prepare(`UPDATE users SET discord_id = ? WHERE id = ?`).run(discordId, userId);
}

// Who should get this kind of Discord ping? Undefined: no ID given, a guest, a disabled account, or they turned it off.
export function discordRecipientFor(userId: number, kind: NotificationKind): { id: number; username: string; discordId: string } | undefined {
  const row = getDb()
    .prepare(`SELECT id, username, discord_id FROM users WHERE id = ? AND discord_id IS NOT NULL AND is_guest = 0 AND disabled_at IS NULL`)
    .get(userId) as { id: number; username: string; discord_id: string } | undefined;
  if (!row || !getPrefs(userId, "discord")[kind]) return undefined;
  return { id: row.id, username: row.username, discordId: row.discord_id };
}


// ---- Web Push ----

export interface PushSubscriptionRow { endpoint: string; p256dh: string; auth: string }

// One account can have a few devices; more than this and the oldest registrations are dropped.
const MAX_PUSH_DEVICES = 10;

// The endpoint is unique per browser. If it is already stored (same browser, other account), it moves to this user.
export function saveSubscription(userId: number, sub: PushSubscriptionRow): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at) VALUES (@userId, @endpoint, @p256dh, @auth, @now)
       ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
    ).run({ userId, ...sub, now: Date.now() });
    db.prepare(
      `DELETE FROM push_subscriptions WHERE user_id = ? AND id NOT IN
         (SELECT id FROM push_subscriptions WHERE user_id = ? ORDER BY id DESC LIMIT ?)`,
    ).run(userId, userId, MAX_PUSH_DEVICES);
  })();
}

// Scoped to the user, so nobody can remove somebody else's device by guessing an endpoint.
export function removeSubscription(userId: number, endpoint: string): boolean {
  return getDb().prepare(`DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?`).run(userId, endpoint).changes > 0;
}

export function removeSubscriptionByEndpoint(endpoint: string): void {
  getDb().prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?`).run(endpoint);
}

export function listSubscriptions(userId: number): PushSubscriptionRow[] {
  return getDb()
    .prepare(`SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ? ORDER BY id`)
    .all(userId) as PushSubscriptionRow[];
}

// Who should get this kind of push? Undefined: no device registered, a guest, a disabled account, or they turned it off.
export function pushRecipientFor(
  userId: number,
  kind: NotificationKind,
): { id: number; username: string; subs: PushSubscriptionRow[] } | undefined {
  const row = getDb()
    .prepare(`SELECT id, username FROM users WHERE id = ? AND is_guest = 0 AND disabled_at IS NULL`)
    .get(userId) as { id: number; username: string } | undefined;
  if (!row || !getPrefs(userId, "push")[kind]) return undefined;
  const subs = listSubscriptions(userId);
  return subs.length > 0 ? { id: row.id, username: row.username, subs } : undefined;
}
