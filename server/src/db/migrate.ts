import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

export function migrate(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)`);
  const row = db.prepare(`SELECT version FROM schema_version`).get() as
    | { version: number }
    | undefined;
  if (!row) db.prepare(`INSERT INTO schema_version (version) VALUES (0)`).run();
  const currentVersion = row?.version ?? 0;

  const pending = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort() // "0001_..." < "0002_..." lexically — zero-pad the prefix
    .filter((f) => Number(f.split("_")[0]) > currentVersion);

  for (const file of pending) {
    const version = Number(file.split("_")[0]);
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    const apply = db.transaction(() => {
      db.exec(sql);
      db.prepare(`UPDATE schema_version SET version = ?`).run(version);
    });
    apply();
  }
}