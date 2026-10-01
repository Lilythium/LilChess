import { mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { getDb } from "./connection.js";
import { logger } from "../logger.js";

const log = logger.child({ mod: "backup" });
const PREFIX = "lilchess-";
const SUFFIX = ".db";
const DAY_MS = 24 * 60 * 60 * 1000;

export interface BackupOptions {
  dir: string;
  keep: number;
  hourUtc: number;
}

export function backupFileName(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${PREFIX}${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}${SUFFIX}`
  );
}

export function listBackups(dir: string): string[] {
  try {
    // Timestamped names sort lexically in chronological order.
    return readdirSync(dir).filter((f) => f.startsWith(PREFIX) && f.endsWith(SUFFIX)).sort();
  } catch {
    return [];
  }
}

export function pruneBackups(dir: string, keep: number): string[] {
  const doomed = listBackups(dir).slice(0, Math.max(0, listBackups(dir).length - keep));
  for (const f of doomed) rmSync(join(dir, f), { force: true });
  return doomed;
}

// db.backup() copies in chunks and yields to the event loop, so moves keep flowing during a backup.
// Write to .tmp then rename, so a crash never leaves a half-written file that looks valid.
export async function runBackup(
  db: Database.Database,
  dir: string,
  keep: number,
  now = new Date(),
): Promise<string> {
  mkdirSync(dir, { recursive: true });
  const finalPath = join(dir, backupFileName(now));
  const tmpPath = `${finalPath}.tmp`;
  await db.backup(tmpPath);
  renameSync(tmpPath, finalPath);
  pruneBackups(dir, keep);
  return finalPath;
}

/** Milliseconds until the next occurrence of hourUtc:00:00 UTC. */
export function msUntilNextRun(now: Date, hourUtc: number): number {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc, 0, 0));
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

function newestBackupAgeMs(dir: string): number | undefined {
  const newest = listBackups(dir).at(-1);
  if (!newest) return undefined;
  try {
    return Date.now() - statSync(join(dir, newest)).mtimeMs;
  } catch {
    return undefined;
  }
}

// ---- scheduler ----
let timer: NodeJS.Timeout | undefined;
let inFlight: Promise<void> | undefined;
let active: BackupOptions | undefined;

async function runOnce(o: BackupOptions): Promise<void> {
  inFlight = runBackup(getDb(), o.dir, o.keep)
    .then((file) => log.info({ file }, "backup complete"))
    .catch((err) => log.error({ err }, "backup failed"))
    .finally(() => {
      inFlight = undefined;
    });
  await inFlight;
}

function schedule(o: BackupOptions, delayMs: number): void {
  timer = setTimeout(async () => {
    await runOnce(o);
    if (active) schedule(o, msUntilNextRun(new Date(), o.hourUtc));
  }, delayMs);
  timer.unref();
}

export function startBackupScheduler(o: BackupOptions): void {
  active = o;
  // If the server was down at backup time (or this is a fresh install), take one shortly after boot.
  const age = newestBackupAgeMs(o.dir);
  const stale = age === undefined || age > DAY_MS;
  schedule(o, stale ? 10_000 : msUntilNextRun(new Date(), o.hourUtc));
  log.info({ dir: o.dir, keep: o.keep, hourUtc: o.hourUtc, runningSoon: stale }, "backup scheduler started");
}

/** Cancels the timer and waits for any in-flight backup to finish. */
export async function stopBackupScheduler(): Promise<void> {
  active = undefined;
  if (timer) clearTimeout(timer);
  timer = undefined;
  await inFlight;
}