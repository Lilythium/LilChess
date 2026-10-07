import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

function migrationFiles(): string[] {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  const versions = files.map((file) => versionOf(file));
  if (new Set(versions).size !== versions.length) throw new Error("duplicate migration version number");
  return files.sort((a, b) => versionOf(a) - versionOf(b));
}

const versionOf = (file: string) => Number(file.split("_")[0]);

export function latestVersion(): number {
  return Math.max(0, ...migrationFiles().map(versionOf));
}

// `targetVersion` lets tests build an older schema and then upgrade it.
export function migrate(db: Database.Database, targetVersion = Infinity): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)`);
  const row = db.prepare(`SELECT version FROM schema_version`).get() as
    | { version: number }
    | undefined;
  if (!row) db.prepare(`INSERT INTO schema_version (version) VALUES (0)`).run();
  const currentVersion = row?.version ?? 0;

  const pending = migrationFiles().filter((f) => versionOf(f) > currentVersion && versionOf(f) <= targetVersion);

  for (const file of pending) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    // Table rebuilds need foreign keys off, and the pragma is a no-op inside a transaction.
    db.pragma("foreign_keys = OFF");
    try {
      db.transaction(() => {
        db.exec(sql);
        const violations = db.pragma("foreign_key_check") as unknown[];
        if (violations.length > 0) {
          throw new Error(`migration ${file} left foreign key violations: ${JSON.stringify(violations.slice(0, 5))}`);
        }
        db.prepare(`UPDATE schema_version SET version = ?`).run(versionOf(file));
      })();
    } finally {
      db.pragma("foreign_keys = ON");
    }
  }
}