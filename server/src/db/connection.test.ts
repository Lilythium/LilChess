import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { closeDb, openDb } from "./connection.js";

let dir: string | undefined;

afterEach(() => {
  closeDb();
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

it("configures WAL and the intended SQLite performance pragmas for a file database", () => {
  dir = mkdtempSync(join(tmpdir(), "lilchess-sqlite-tuning-"));
  const db = openDb(join(dir, "lilchess.db"));

  expect(db.pragma("journal_mode", { simple: true })).toBe("wal");
  // SQLite reports synchronous=NORMAL as numeric value 1.
  expect(db.pragma("synchronous", { simple: true })).toBe(1);
  expect(db.pragma("mmap_size", { simple: true })).toBe(64 * 1024 * 1024);
});
