import { RegisterBody } from "@lilchess/shared";
import type Database from "better-sqlite3";
import { createUser } from "./queries.js";
import { hashPassword } from "./crypto.js";

export type BootstrapResult = "not_configured" | "has_admin" | "promoted" | "created" | "missing_user" | "invalid";

/**
 * Makes sure a fresh server has someone who can administer it. Runs at startup and does nothing once any
 * administrator exists, so public registrations are never promoted later.
 *  - ADMIN_USERNAME names an existing registered account: it is promoted.
 *  - ADMIN_USERNAME doesn't exist yet and ADMIN_PASSWORD is set: the account is created as an administrator.
 *    This is what makes REGISTRATION=closed usable, where nobody could otherwise register the first account.
 * The password is only ever used to create a new account, never to change an existing one.
 */
export async function bootstrapAdmin(
  db: Database.Database,
  opts: { username: string | undefined; password: string | undefined },
  log: { info: (obj: object, msg: string) => void; warn: (obj: object, msg: string) => void },
): Promise<BootstrapResult> {
  if (hasAdmin(db)) return "has_admin";
  if (!opts.username) return "not_configured";

  const username = opts.username.trim().toLowerCase();
  const promoted = db.prepare(`UPDATE users SET is_admin = 1 WHERE username = ? AND is_guest = 0 AND disabled_at IS NULL`).run(username);
  if (promoted.changes) {
    log.info({ username }, "bootstrapped initial administrator");
    return "promoted";
  }

  if (db.prepare(`SELECT 1 FROM users WHERE username = ?`).get(username)) {
    log.warn({ username }, "ADMIN_USERNAME is a guest or disabled account, so it can't become the administrator");
    return "invalid";
  }
  if (!opts.password) {
    log.warn({ username }, "ADMIN_USERNAME doesn't exist yet: register it, or set ADMIN_PASSWORD to have it created");
    return "missing_user";
  }

  const checked = RegisterBody.pick({ username: true, password: true }).safeParse({ username, password: opts.password });
  if (!checked.success) {
    log.warn({ username, problem: checked.error.issues[0]?.message }, "ADMIN_USERNAME / ADMIN_PASSWORD can't be used to create an account");
    return "invalid";
  }
  createUser(checked.data.username, await hashPassword(checked.data.password), true);
  log.info({ username }, "created the initial administrator; remove ADMIN_PASSWORD from the environment now");
  return "created";
}

function hasAdmin(db: Database.Database): boolean {
  return db.prepare(`SELECT 1 FROM users WHERE is_admin = 1 AND disabled_at IS NULL`).get() !== undefined;
}