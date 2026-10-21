import { getDb } from "../db/connection.js";
import { createAdminResetToken } from "../auth/passwordReset.js";
import { createUser, type User } from "../auth/queries.js";
import { recordAudit } from "./audit.js";

export class AdminError extends Error {
  constructor(message: string, readonly status: 404 | 409 = 409) {
    super(message);
  }
}

interface Target {
  id: number;
  username: string;
  is_admin: number;
  is_guest: number;
  disabled_at: number | null;
}

function loadTarget(userId: number): Target {
  const target = getDb()
    .prepare(`SELECT id, username, is_admin, is_guest, disabled_at FROM users WHERE id = ? AND deleted_at IS NULL`)
    .get(userId) as Target | undefined;
  if (!target) throw new AdminError("User not found", 404);
  return target;
}

/** Administrators who can actually sign in, not counting `excluding`. */
function otherActiveAdmins(excluding: number): number {
  return getDb()
    .prepare(`SELECT COUNT(*) FROM users WHERE is_admin = 1 AND disabled_at IS NULL AND id <> ?`)
    .pluck()
    .get(excluding) as number;
}

/** Creates a registered account whatever the REGISTRATION mode is. The caller hashes the password. */
export function createUserAsAdmin(actorId: number, username: string, passwordHash: string, isAdmin: boolean): User {
  return getDb().transaction(() => {
    let user: User;
    try {
      user = createUser(username, passwordHash, isAdmin);
    } catch (err) {
      if ((err as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE") throw new AdminError("Username taken");
      throw err;
    }
    recordAudit(actorId, "user.create", `user:${user.username}`, { userId: user.id, isAdmin });
    return user;
  }).immediate();
}

/** Returns whether anything changed. */
export function setUserAdmin(actorId: number, userId: number, isAdmin: boolean): boolean {
  return getDb().transaction(() => {
    const target = loadTarget(userId);
    if (userId === actorId && !isAdmin) throw new AdminError("You cannot remove your own administrator access");
    if (isAdmin && target.is_guest) throw new AdminError("Guest accounts cannot be administrators");
    if (isAdmin && target.disabled_at !== null) throw new AdminError("Enable this account before making it an administrator");
    if (!isAdmin && target.is_admin && otherActiveAdmins(userId) === 0) {
      throw new AdminError("At least one administrator must remain");
    }
    if (Boolean(target.is_admin) === isAdmin) return false; // nothing to change, nothing to log
    getDb().prepare(`UPDATE users SET is_admin = ? WHERE id = ?`).run(isAdmin ? 1 : 0, userId);
    recordAudit(actorId, isAdmin ? "user.grant_admin" : "user.revoke_admin", `user:${target.username}`, { userId });
    return true;
  }).immediate();
}

export function revokeUserSessions(actorId: number, userId: number): number {
  return getDb().transaction(() => {
    const target = loadTarget(userId);
    if (userId === actorId) throw new AdminError("You cannot revoke your own session");
    const revoked = getDb().prepare(`DELETE FROM sessions WHERE user_id = ?`).run(userId).changes;
    recordAudit(actorId, "user.revoke_sessions", `user:${target.username}`, { userId, revoked });
    return revoked;
  }).immediate();
}

/**
 * Issues a one-time password reset token for an account, to be passed on privately by the administrator.
 * The token itself is never logged: the audit entry only says that a link was issued.
 */
export function issuePasswordResetLink(actorId: number, userId: number): { token: string; expiresAt: number; username: string } {
  return getDb().transaction(() => {
    const target = loadTarget(userId);
    if (target.is_guest) throw new AdminError("Guest accounts have no password to reset");
    if (target.disabled_at !== null) throw new AdminError("Enable this account before resetting its password");
    const { token, expiresAt } = createAdminResetToken(userId);
    recordAudit(actorId, "user.reset_link", `user:${target.username}`, { userId, expiresAt });
    return { token, expiresAt, username: target.username };
  }).immediate();
}

export interface DisableResult {
  activeGames: number; // games still running: disabling an account doesn't touch them
}

/**
 * Disabling signs the account out everywhere, stops it logging in, and takes it out of circulation: its open
 * challenges go, it leaves tournaments that haven't started, and it drops off the leaderboard. Games already in
 * progress are left alone (an admin can terminate them) and so is the account's history.
 */
export function setUserDisabled(actorId: number, userId: number, disabled: boolean): DisableResult {
  const db = getDb();
  return db.transaction(() => {
    const target = loadTarget(userId);
    if (disabled) {
      if (userId === actorId) throw new AdminError("You cannot disable your own account");
      if (target.disabled_at !== null) throw new AdminError("This account is already disabled");
      if (target.is_admin && otherActiveAdmins(userId) === 0) throw new AdminError("At least one administrator must remain active");
      db.prepare(`UPDATE users SET disabled_at = ? WHERE id = ?`).run(Date.now(), userId);
      const sessions = db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(userId).changes;
      const challenges = db.prepare(`DELETE FROM challenges WHERE from_user = ?`).run(userId).changes;
      db.prepare(`DELETE FROM password_resets WHERE user_id = ?`).run(userId);
      const tournaments = db.prepare(`
        DELETE FROM tournament_participants
        WHERE user_id = ? AND tournament_id IN (SELECT id FROM tournaments WHERE status = 'open')
      `).run(userId).changes;
      recordAudit(actorId, "user.disable", `user:${target.username}`, { userId, sessions, challenges, tournaments });
    } else {
      if (target.disabled_at === null) throw new AdminError("This account is not disabled");
      db.prepare(`UPDATE users SET disabled_at = NULL WHERE id = ?`).run(userId);
      recordAudit(actorId, "user.enable", `user:${target.username}`, { userId });
    }
    const activeGames = db
      .prepare(`SELECT COUNT(*) FROM games WHERE status = 'started' AND (white_id = ? OR black_id = ?)`)
      .pluck()
      .get(userId, userId) as number;
    return { activeGames };
  }).immediate();
}