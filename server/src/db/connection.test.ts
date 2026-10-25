import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { closeDb, openDb } from "./connection.js";

let dir: string | undefined;

afterEach(() => {
  vi.useRealTimers();
  closeDb();
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

it("configures WAL, NORMAL synchronous mode, and disables mmap for a file database", () => {
  dir = mkdtempSync(join(tmpdir(), "lilchess-sqlite-tuning-"));
  const db = openDb(join(dir, "lilchess.db"));

  expect(db.pragma("journal_mode", { simple: true })).toBe("wal");
  // SQLite reports synchronous=NORMAL as numeric value 1.
  expect(db.pragma("synchronous", { simple: true })).toBe(1);
  expect(db.pragma("mmap_size", { simple: true })).toBe(0);
});

it("reuses the compiled statement for identical SQL", () => {
  const db = openDb(":memory:");
  expect(db.prepare("SELECT 1 AS n")).toBe(db.prepare("SELECT 1 AS n"));
  expect(db.prepare("SELECT 1 AS n")).not.toBe(db.prepare("SELECT 2 AS n"));
});

it("does not let pluck() on a shared statement leak to the next caller of the same SQL", () => {
  const db = openDb(":memory:");
  const sql = "SELECT 42 AS n";
  expect(db.prepare(sql).pluck().get()).toBe(42);
  expect(db.prepare(sql).get()).toEqual({ n: 42 });
  // Statements that return no rows must still be preparable (pluck only applies to readers).
  expect(() => db.prepare("CREATE TABLE IF NOT EXISTS t (x)").run()).not.toThrow();
});

it("keeps the statement cache bounded and evicts the least recently used SQL", () => {
  const db = openDb(":memory:");
  const first = db.prepare("SELECT 0 AS n");
  for (let i = 1; i <= 700; i++) db.prepare(`SELECT ${i} AS n`).get();
  const again = db.prepare("SELECT 0 AS n");
  expect(again).not.toBe(first); // evicted, so recompiled...
  expect(again.get()).toEqual({ n: 0 }); // ...and still works
  expect(first.get()).toEqual({ n: 0 }); // a caller holding an evicted statement is unaffected
});

it("takes checkpointing off the commit path for file databases only", () => {
  expect(openDb(":memory:").pragma("wal_autocheckpoint", { simple: true })).toBe(1000);
  closeDb();

  dir = mkdtempSync(join(tmpdir(), "lilchess-wal-checkpoint-"));
  vi.useFakeTimers();
  const db = openDb(join(dir, "lilchess.db"));
  expect(db.pragma("wal_autocheckpoint", { simple: true })).toBe(0);

  const pragma = vi.spyOn(db, "pragma");
  vi.advanceTimersByTime(5_000);
  expect(pragma).toHaveBeenCalledWith("wal_checkpoint(PASSIVE)");

  // Once closed, the timer must be gone.
  closeDb();
  pragma.mockClear();
  vi.advanceTimersByTime(60_000);
  expect(pragma).not.toHaveBeenCalled();
});
