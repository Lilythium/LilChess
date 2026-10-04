import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createGame } from "@lilchess/shared";
import { afterEach, beforeEach, expect, it } from "vitest";
import { runBackup } from "./backup.js";
import { closeDb, getDb, openDb } from "./connection.js";
import { checkIntegrity } from "./integrity.js";
import { latestVersion } from "./migrate.js";
import { applyMoveAndPersist, getGame, insertGame } from "./repositories/games.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lilchess-restore-"));
});
afterEach(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

it("a backup restores into a working, consistent database", async () => {
  openDb(join(dir, "live", "lilchess.db"));
  const db = getDb();
  db.exec(`INSERT INTO users (id, username, password_hash, created_at) VALUES (1,'alice','x',0),(2,'bob','x',0)`);
  insertGame("g1", 1, 2, createGame({ clock: { mode: "live", initialMs: 60_000, incrementMs: 0 }, now: Date.now() }));
  expect(applyMoveAndPersist("g1", "e2e4", Date.now()).ok).toBe(true);

  const backup = await runBackup(db, join(dir, "backups"), 7);
  closeDb();

  // Restore = put the file where the server expects it and start.
  const restored = join(dir, "restored", "lilchess.db");
  mkdirSync(dirname(restored), { recursive: true });
  copyFileSync(backup, restored);

  const db2 = openDb(restored);
  expect(db2.prepare(`SELECT version FROM schema_version`).get()).toEqual({ version: latestVersion() });
  expect(checkIntegrity(db2, { deep: true })).toEqual([]);
  expect(getGame("g1")?.moves).toEqual(["e2e4"]);
});