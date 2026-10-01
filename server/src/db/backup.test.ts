import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backupFileName, listBackups, msUntilNextRun, runBackup } from "./backup.js";

let dir: string;
let db: Database.Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lilchess-backup-"));
  db = new Database(join(dir, "live.db"));
  db.pragma("journal_mode = WAL");
  db.exec(`CREATE TABLE t (n INTEGER); INSERT INTO t VALUES (42);`);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("runBackup", () => {
  it("writes a readable copy and leaves no .tmp behind", async () => {
    const out = join(dir, "backups");
    const file = await runBackup(db, out, 7, new Date("2026-10-01T03:00:00Z"));
    expect(file.endsWith("lilchess-20261001-030000.db")).toBe(true);
    expect(readdirSync(out).some((f) => f.endsWith(".tmp"))).toBe(false);

    const copy = new Database(file, { readonly: true });
    expect((copy.prepare(`SELECT n FROM t`).get() as { n: number }).n).toBe(42);
    copy.close();
  });

  it("keeps only the newest N backups", async () => {
    const out = join(dir, "backups");
    for (let day = 1; day <= 5; day++) {
      await runBackup(db, out, 3, new Date(Date.UTC(2026, 9, day, 3)));
    }
    expect(listBackups(out)).toEqual([
      backupFileName(new Date(Date.UTC(2026, 9, 3, 3))),
      backupFileName(new Date(Date.UTC(2026, 9, 4, 3))),
      backupFileName(new Date(Date.UTC(2026, 9, 5, 3))),
    ]);
  });
});

describe("msUntilNextRun", () => {
  it("targets later today when the hour hasn't passed", () => {
    expect(msUntilNextRun(new Date("2026-10-01T01:00:00Z"), 3)).toBe(2 * 3_600_000);
  });
  it("rolls to tomorrow when it has", () => {
    expect(msUntilNextRun(new Date("2026-10-01T04:00:00Z"), 3)).toBe(23 * 3_600_000);
  });
});