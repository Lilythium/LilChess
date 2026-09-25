import { getDb } from "../db/connection.js";

export interface User {
  id: number;
  username: string;
  created_at: number;
  is_admin: number;
}

export function getUserByUsername(username: string) {
  return getDb().prepare(`SELECT * FROM users WHERE username = ?`).get(username) as (User & { password_hash: string }) | undefined;
}

export function createUser(username: string, passwordHash: string): User {
  const now = Date.now();
  const info = getDb().prepare(`
    INSERT INTO users (username, password_hash, created_at, is_admin) 
    VALUES (?, ?, ?, ?)
  `).run(username, passwordHash, now, 0);

  return { id: info.lastInsertRowid as number, username, created_at: now, is_admin: 0 };
}

export function createSession(tokenHash: string, userId: number, expiresAt: number) {
  getDb().prepare(`
    INSERT INTO sessions (token_hash, user_id, expires_at) 
    VALUES (?, ?, ?)
  `).run(tokenHash, userId, expiresAt);
}

export function getSessionUser(tokenHash: string): User | undefined {
  return getDb().prepare(`
    SELECT u.id, u.username, u.created_at, u.is_admin 
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).get(tokenHash, Date.now()) as User | undefined;
}

export function deleteSession(tokenHash: string) {
  getDb().prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(tokenHash);
}