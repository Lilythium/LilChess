import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { migrate } from "./migrate.js";
import { backfillPositions, backfillSnapshots } from "./backfill.js";
import { clearActiveGameCache } from "../game/activeGameCache.js";

let db: Database.Database | undefined;

export function openDb(path: string): Database.Database {
  clearActiveGameCache();
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  db = new Database(path);
  // WAL lets readers proceed while a writer commits. NORMAL keeps commits fast while
  // preserving database consistency; the latest commits can be lost on power/OS failure.
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  // Cap memory-mapped reads at 64 MiB. SQLite maps pages on demand; this is not an
  // eager 64 MiB allocation. Keep this value measurable/tunable with the DB benchmark.
  db.pragma("mmap_size = 67108864");
  db.pragma("foreign_keys = ON"); // off by default in SQLite
  migrate(db);
  backfillPositions(db);
  backfillSnapshots(db);
  return db;
}

export function getDb(): Database.Database {
  if (!db) throw new Error("db not initialized — call openDb() first");
  return db;
}

export function closeDb(): void {
  if (!db) return;
  clearActiveGameCache();
  try {
    db.pragma("wal_checkpoint(TRUNCATE)"); // fold the WAL into the main file before closing
  } catch {
    // best effort; close() below also checkpoints
  }
  db.close();
  db = undefined;
}