import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { migrate } from "./migrate.js";

let db: Database.Database | undefined;

export function openDb(path: string): Database.Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON"); // off by default in SQLite
  migrate(db);
  return db;
}

export function getDb(): Database.Database {
  if (!db) throw new Error("db not initialized — call openDb() first");
  return db;
}

export function closeDb(): void {
  db?.close();
  db = undefined;
}