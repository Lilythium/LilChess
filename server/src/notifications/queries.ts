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

export function getPrefs(userId: number): Prefs {
  const prefs = Object.fromEntries(NOTIFICATION_KINDS.map((k) => [k, true])) as Prefs;
  const rows = getDb()
    .prepare(`SELECT kind, enabled FROM notification_prefs WHERE user_id = ?`)
    .all(userId) as { kind: string; enabled: number }[];
  for (const r of rows) if (r.kind in prefs) prefs[r.kind as NotificationKind] = r.enabled === 1;
  return prefs;
}

export function setPrefs(userId: number, changes: Partial<Prefs>): void {
  const db = getDb();
  const upsert = db.prepare(
    `INSERT INTO notification_prefs (user_id, kind, enabled) VALUES (?, ?, ?)
     ON CONFLICT(user_id, kind) DO UPDATE SET enabled = excluded.enabled`,
  );
  db.transaction(() => {
    for (const [kind, enabled] of Object.entries(changes)) {
      if (enabled !== undefined) upsert.run(userId, kind, enabled ? 1 : 0);
    }
  })();
}

// Who should get this kind of email? Undefined: no address, a guest, or they turned it off.
export function recipientFor(userId: number, kind: NotificationKind): Recipient | undefined {
  const row = getDb()
    .prepare(`SELECT id, username, email, unsubscribe_token FROM users WHERE id = ? AND email IS NOT NULL AND is_guest = 0`)
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