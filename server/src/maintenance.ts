import { getDb } from "./db/connection.js";
import { logger } from "./logger.js";
import { expirePendingSimuls } from "./simuls/service.js";

const log = logger.child({ mod: "maintenance" });
const INTERVAL_MS = 60 * 60 * 1000;
// Pending simuls expire after hours, not days, so they get their own cheap (indexed) sweep.
const SIMUL_SWEEP_MS = 60 * 1000;
let timer: NodeJS.Timeout | undefined;
let simulTimer: NodeJS.Timeout | undefined;

const DAY_MS = 24 * 60 * 60 * 1000;

export function purgeUnusedGuests(now = Date.now()): number {
  const db = getDb();
  return db.transaction(() => {
    db.prepare(`
      DELETE FROM sessions
      WHERE expires_at <= ? AND user_id IN (SELECT id FROM users WHERE is_guest = 1)
    `).run(now);
    db.prepare(`
      DELETE FROM challenges
      WHERE expires_at <= ? AND (
        from_user IN (SELECT id FROM users WHERE is_guest = 1)
        OR to_user IN (SELECT id FROM users WHERE is_guest = 1)
      )
    `).run(now);
    return db.prepare(`
      DELETE FROM users
      WHERE is_guest = 1
        AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = users.id)
        AND NOT EXISTS (SELECT 1 FROM games g WHERE g.white_id = users.id OR g.black_id = users.id)
        AND NOT EXISTS (SELECT 1 FROM challenges c WHERE c.from_user = users.id OR c.to_user = users.id)
    `).run().changes;
  }).immediate();
}

// Expired sessions and challenges are already ignored by queries; this just stops the tables growing forever.
export function purgeExpired(now = Date.now()): {
  sessions: number; challenges: number; guests: number; resets: number; notifications: number; simuls: number;
} {
  const db = getDb();
  const sessions = db.prepare(`DELETE FROM sessions WHERE expires_at <= ?`).run(now).changes;
  const challenges = db.prepare(`DELETE FROM challenges WHERE expires_at <= ?`).run(now).changes;
  const resets = db.prepare(`DELETE FROM password_resets WHERE expires_at <= ?`).run(now).changes;
  // The dedup log only has to outlive the window in which a duplicate could happen.
  const notifications = db.prepare(`DELETE FROM notification_log WHERE created_at < ?`).run(now - 30 * DAY_MS).changes;
  // A guest with no session who never played or challenged anyone can never be reached again.
  const guests = purgeUnusedGuests(now);
  const simuls = expirePendingSimuls(now);
  return { sessions, challenges, guests, resets, notifications, simuls };
}

function run(): void {
  try {
    const r = purgeExpired();
    if (Object.values(r).some(Boolean)) log.info(r, "purged expired rows");
  } catch (err) {
    log.error({ err }, "maintenance failed");
  }
}

function sweepSimuls(): void {
  try {
    const n = expirePendingSimuls();
    if (n > 0) log.info({ simuls: n }, "cancelled simuls that never started");
  } catch (err) {
    log.error({ err }, "simul expiry failed");
  }
}

export function startMaintenance(): void {
  run();
  timer = setInterval(run, INTERVAL_MS);
  timer.unref();
  simulTimer = setInterval(sweepSimuls, SIMUL_SWEEP_MS);
  simulTimer.unref();
}

export function stopMaintenance(): void {
  if (timer) clearInterval(timer);
  if (simulTimer) clearInterval(simulTimer);
  timer = undefined;
  simulTimer = undefined;
}