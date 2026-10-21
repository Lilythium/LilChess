import { randomBytes } from "node:crypto";
import { getDb } from "../db/connection.js";

/** The person can't delete the account right now; `reasons` say what to do first, in plain words. */
export class DeletionBlocked extends Error {
  constructor(readonly reasons: string[]) {
    super(reasons.join(" "));
  }
}

interface Row {
  id: number;
  is_admin: number;
  deleted_at: number | null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Things that must be finished before an account can go. Empty means it can be deleted. */
export function deletionBlockers(userId: number): string[] {
  const db = getDb();
  const reasons: string[] = [];

  const admin = db.prepare(`SELECT is_admin FROM users WHERE id = ?`).pluck().get(userId) as number | undefined;
  if (admin === 1) {
    reasons.push("Administrators can't delete their own account. Ask another administrator to remove your administrator access first.");
  }
  const games = db
    .prepare(`SELECT COUNT(*) FROM games WHERE status = 'started' AND (white_id = ? OR black_id = ?)`)
    .pluck()
    .get(userId, userId) as number;
  if (games > 0) reasons.push(`You have ${plural(games, "game", "games")} in progress. Finish or resign ${games === 1 ? "it" : "them"} first.`);

  const hosting = db.prepare(`
    SELECT (SELECT COUNT(*) FROM tournaments WHERE created_by = ? AND status IN ('open', 'running'))
         + (SELECT COUNT(*) FROM simuls WHERE host_id = ? AND status IN ('open', 'running'))
  `).pluck().get(userId, userId) as number;
  if (hosting > 0) reasons.push("You are running a tournament or simul that hasn't finished. Cancel or finish it first.");

  const playing = db.prepare(`
    SELECT COUNT(*) FROM tournament_participants p JOIN tournaments t ON t.id = p.tournament_id
    WHERE p.user_id = ? AND t.status = 'running'
  `).pluck().get(userId) as number;
  if (playing > 0) reasons.push("You are taking part in a tournament that is running. Wait until it finishes.");
  return reasons;
}

/**
 * Deletes an account for good. The person can never get it back, and nothing here can be undone.
 *
 * The row in `users` stays as an anonymous tombstone, because other people's games, moves and tournament results
 * point at it: it keeps its id, loses its name (`deleted_xxxxxxxx`, shown as "Deleted user"), password, email and
 * Discord id, and is marked disabled so it can never sign in. Their games and the opponents' ratings stay as they were.
 *
 * Removed outright: sessions, open challenges, password-reset tokens, notification settings and log, ratings and
 * rating history, imported games, a seat in tournaments that haven't started, and unaccepted simul invitations.
 * The username becomes free to register again.
 *
 * Returns false if there is no such live account. Throws DeletionBlocked while games or events are unfinished.
 */
export function deleteAccount(userId: number, now = Date.now()): boolean {
  const db = getDb();
  return db.transaction(() => {
    const user = db.prepare(`SELECT id, is_admin, deleted_at FROM users WHERE id = ?`).get(userId) as Row | undefined;
    if (!user || user.deleted_at !== null) return false;
    const blockers = deletionBlockers(userId);
    if (blockers.length > 0) throw new DeletionBlocked(blockers);

    const rename = db.prepare(`
      UPDATE users
      SET username = ?, password_hash = '!', email = NULL, discord_id = NULL, unsubscribe_token = NULL,
          disabled_at = ?, deleted_at = ?
      WHERE id = ?
    `);
    for (let attempt = 0; ; attempt++) {
      try {
        rename.run(`deleted_${randomBytes(4).toString("hex")}`, now, now, userId);
        break;
      } catch (err) {
        if (attempt >= 5 || (err as { code?: string }).code !== "SQLITE_CONSTRAINT_UNIQUE") throw err;
      }
    }

    db.prepare(`DELETE FROM challenges WHERE from_user = ? OR to_user = ?`).run(userId, userId);
    for (const sql of [
      `DELETE FROM sessions WHERE user_id = ?`,
      `DELETE FROM password_resets WHERE user_id = ?`,
      `DELETE FROM notification_prefs WHERE user_id = ?`,
      `DELETE FROM notification_prefs_discord WHERE user_id = ?`,
      `DELETE FROM notification_log WHERE user_id = ?`,
      `DELETE FROM rating_history WHERE user_id = ?`,
      `DELETE FROM ratings WHERE user_id = ?`,
      `DELETE FROM imported_games WHERE owner_id = ?`,
      `DELETE FROM tournament_participants WHERE user_id = ? AND tournament_id IN (SELECT id FROM tournaments WHERE status = 'open')`,
      `DELETE FROM simul_players WHERE user_id = ? AND game_id IS NULL`,
    ]) {
      db.prepare(sql).run(userId);
    }
    return true;
  }).immediate();
}
