import { normalizeUsername } from "@lilchess/shared";
import { getDb } from "../db/connection.js";
import { generateSessionToken, hashSessionToken } from "./crypto.js";

const RESET_TTL_MS = 60 * 60 * 1000;
const RESEND_COOLDOWN_MS = 5 * 60 * 1000;
const MAX_TARGETS = 5;

export interface ResetTarget { id: number; username: string; email: string }

// Accepts a username or an email. Emails aren't unique (they're unverified), so an email can
// match a few accounts: each gets its own link. Guests and accounts without an email never match.
export function findResetTargets(identifier: string): ResetTarget[] {
  const raw = identifier.trim();
  const db = getDb();
  return (raw.includes("@")
    ? db.prepare(`SELECT id, username, email FROM users WHERE email = ? AND is_guest = 0 LIMIT ?`).all(raw.toLowerCase(), MAX_TARGETS)
    : db.prepare(`SELECT id, username, email FROM users WHERE username = ? AND email IS NOT NULL AND is_guest = 0`).all(normalizeUsername(raw))
  ) as ResetTarget[];
}

// Returns the plaintext token (only its hash is stored), or null inside the resend cooldown.
export function createResetToken(userId: number, now = Date.now()): string | null {
  const db = getDb();
  const recent = db.prepare(`SELECT 1 FROM password_resets WHERE user_id = ? AND created_at > ?`).get(userId, now - RESEND_COOLDOWN_MS);
  if (recent) return null;
  const token = generateSessionToken();
  db.prepare(`INSERT INTO password_resets (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`)
    .run(hashSessionToken(token), userId, now, now + RESET_TTL_MS);
  return token;
}

// Sets the new password, burns every outstanding link and logs the user out everywhere.
export function consumeResetToken(tokenHash: string, newPasswordHash: string, now = Date.now()): boolean {
  const db = getDb();
  return db.transaction(() => {
    const row = db
      .prepare(`SELECT user_id FROM password_resets WHERE token_hash = ? AND expires_at > ?`)
      .get(tokenHash, now) as { user_id: number } | undefined;
    if (!row) return false;
    db.prepare(`UPDATE users SET password_hash = ? WHERE id = ? AND is_guest = 0`).run(newPasswordHash, row.user_id);
    db.prepare(`DELETE FROM password_resets WHERE user_id = ?`).run(row.user_id);
    db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(row.user_id);
    return true;
  }).immediate();
}