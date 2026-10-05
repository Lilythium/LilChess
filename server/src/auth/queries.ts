import { randomBytes } from "node:crypto";
import { getDb } from "../db/connection.js";
import { normalizeUsername } from "@lilchess/shared";

export interface User {
  id: number;
  username: string;
  created_at: number;
  is_admin: number;
  is_guest: number;
}

export function getUserByUsername(username: string) {
  return getDb().prepare(
    `SELECT * FROM users WHERE LOWER(username) = LOWER(?)`
  ).get(username);
}

export function createUser(username: string, passwordHash: string): User {
  const now = Date.now();
  const info = getDb().prepare(`
    INSERT INTO users (username, password_hash, created_at, is_admin)
    VALUES (?, ?, ?, ?)
  `).run(normalizeUsername(username), passwordHash, now, 0);

  return { id: info.lastInsertRowid as number, username: normalizeUsername(username), created_at: now, is_admin: 0, is_guest: 0 };
}

// '!' can never match a "salt:hash" value, so guests cannot log in with a password.
export function createGuest(): User {
  const db = getDb();
  const now = Date.now();
  for (let attempt = 0; attempt < 5; attempt++) {
    const username = `guest_${randomBytes(3).toString("hex")}`;
    try {
      const info = db.prepare(`
        INSERT INTO users (username, password_hash, created_at, is_admin, is_guest)
        VALUES (?, '!', ?, 0, 1)
      `).run(username, now);
      return { id: Number(info.lastInsertRowid), username, created_at: now, is_admin: 0, is_guest: 1 };
    } catch (err) {
      if ((err as { code?: string }).code !== "SQLITE_CONSTRAINT_UNIQUE") throw err;
    }
  }
  throw new Error("could not allocate a guest username");
}

export function createSession(tokenHash: string, userId: number, expiresAt: number) {
  getDb().prepare(`
    INSERT INTO sessions (token_hash, user_id, expires_at)
    VALUES (?, ?, ?)
  `).run(tokenHash, userId, expiresAt);
}

export function getSessionUser(tokenHash: string): User | undefined {
  return getDb().prepare(`
    SELECT u.id, u.username, u.created_at, u.is_admin, u.is_guest
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).get(tokenHash, Date.now()) as User | undefined;
}

export function deleteSession(tokenHash: string) {
  getDb().prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(tokenHash);
}