import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { migrate } from "./migrate.js";
import { backfillPositions, backfillSnapshots } from "./backfill.js";
import { clearActiveGameCache } from "../game/activeGameCache.js";

let db: Database.Database | undefined;
let stopCheckpointer: (() => void) | undefined;

const STATEMENT_CACHE_LIMIT = 512;
const WAL_CHECKPOINT_INTERVAL_MS = 5_000;

/**
 * Reuse compiled statements. Without this every `getDb().prepare(sql)` compiles the SQL again and
 * leaves a native sqlite3_stmt behind until the JS wrapper is garbage collected; V8 sees almost no
 * heap pressure from them, so under load RSS balloons while the JS heap stays small.
 * Bounded LRU so call sites that build dynamic SQL (IN (...) lists) cannot grow it forever.
 */
function installStatementCache(database: Database.Database): void {
  const cache = new Map<string, Database.Statement>();
  const rawPrepare = database.prepare.bind(database) as (sql: string) => Database.Statement;
  database.prepare = ((sql: string) => {
    let statement = cache.get(sql);
    if (statement) {
      cache.delete(sql); // refresh recency
    } else {
      statement = rawPrepare(sql);
      if (cache.size >= STATEMENT_CACHE_LIMIT) {
        const oldest = cache.keys().next().value as string | undefined;
        if (oldest !== undefined) cache.delete(oldest);
      }
    }
    cache.set(sql, statement);
    // pluck() sticks to the statement; callers that want plain rows must not inherit it.
    if (statement.reader) statement.pluck(false);
    return statement;
  }) as Database.Database["prepare"];
}

/**
 * SQLite's automatic checkpoint runs inside whichever commit crosses the WAL size threshold, so one
 * unlucky move pays for it (a multi-millisecond p99 spike). Checkpoint on a timer instead, in small
 * passive steps. closeDb() and the nightly backup still fold the WAL in completely.
 */
function startWalCheckpointer(database: Database.Database): () => void {
  database.pragma("wal_autocheckpoint = 0");
  const timer = setInterval(() => {
    if (!database.open) return;
    try {
      database.pragma("wal_checkpoint(PASSIVE)");
    } catch {
      // best effort; the next tick or closeDb() will try again
    }
  }, WAL_CHECKPOINT_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}

export function openDb(path: string): Database.Database {
  clearActiveGameCache();
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  db = new Database(path);
  // WAL lets readers proceed while a writer commits. NORMAL keeps commits fast while
  // preserving database consistency; the latest commits can be lost on power/OS failure.
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("mmap_size = 0");
  db.pragma("foreign_keys = ON"); // off by default in SQLite
  installStatementCache(db);
  stopCheckpointer?.();
  stopCheckpointer = path === ":memory:" ? undefined : startWalCheckpointer(db);
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
  stopCheckpointer?.();
  stopCheckpointer = undefined;
  try {
    db.pragma("wal_checkpoint(TRUNCATE)"); // fold the WAL into the main file before closing
  } catch {
    // best effort; close() below also checkpoints
  }
  db.close();
  db = undefined;
}