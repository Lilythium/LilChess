import { getDb } from "./db/connection.js";
import { logger } from "./logger.js";

const log = logger.child({ mod: "maintenance" });
const INTERVAL_MS = 60 * 60 * 1000;
let timer: NodeJS.Timeout | undefined;

// Expired sessions and challenges are already ignored by queries; this just stops the tables growing forever.
export function purgeExpired(now = Date.now()): { sessions: number; challenges: number } {
  const db = getDb();
  const sessions = db.prepare(`DELETE FROM sessions WHERE expires_at <= ?`).run(now).changes;
  const challenges = db.prepare(`DELETE FROM challenges WHERE expires_at <= ?`).run(now).changes;
  return { sessions, challenges };
}

function run(): void {
  try {
    const r = purgeExpired();
    if (r.sessions || r.challenges) log.info(r, "purged expired rows");
  } catch (err) {
    log.error({ err }, "maintenance failed");
  }
}

export function startMaintenance(): void {
  run();
  timer = setInterval(run, INTERVAL_MS);
  timer.unref();
}

export function stopMaintenance(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
}