import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { migrate } from "./migrate.js";
import { backfillPositions } from "./backfill.js";

let db: Database.Database | undefined;

export function openDb(path: string): Database.Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON"); // off by default in SQLite
  migrate(db);
  backfillPositions(db);
  return db;
}

export function getDb(): Database.Database {
  if (!db) throw new Error("db not initialized — call openDb() first");
  return db;
}

export function closeDb(): void {
  if (!db) return;
  try {
    db.pragma("wal_checkpoint(TRUNCATE)"); // fold the WAL into the main file before closing
  } catch {
    // best effort; close() below also checkpoints
  }
  db.close();
  db = undefined;
}