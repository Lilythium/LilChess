import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, getDb, openDb } from "../db/connection.js";
import { verifyPassword } from "./crypto.js";
import { bootstrapAdmin } from "./bootstrap.js";
import { createUser } from "./queries.js";

describe("bootstrapAdmin", () => {
  const log = { info: vi.fn(), warn: vi.fn() };
  const run = (username?: string, password?: string) => bootstrapAdmin(getDb(), { username, password }, log);
  const user = (name: string) =>
    getDb().prepare(`SELECT id, is_admin, is_guest, password_hash FROM users WHERE username = ?`).get(name) as
      { id: number; is_admin: number; is_guest: number; password_hash: string } | undefined;

  beforeEach(() => {
    openDb(":memory:");
    log.info.mockClear();
    log.warn.mockClear();
  });
  afterEach(() => closeDb());

  it("does nothing when nothing is configured", async () => {
    expect(await run()).toBe("not_configured");
    expect(await run(undefined, "hunter22!")).toBe("not_configured");
  });

  it("promotes an existing registered account", async () => {
    createUser("alice", "x");
    expect(await run("Alice")).toBe("promoted");
    expect(user("alice")!.is_admin).toBe(1);
  });

  it("creates the account when it doesn't exist and a password is given: the closed-registration case", async () => {
    expect(await run("boss", "correct horse")).toBe("created");
    const row = user("boss")!;
    expect(row).toMatchObject({ is_admin: 1, is_guest: 0 });
    expect(await verifyPassword("correct horse", row.password_hash)).toBe(true);
  });

  it("explains itself when the account is missing and there's no password", async () => {
    expect(await run("boss")).toBe("missing_user");
    expect(user("boss")).toBeUndefined();
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it("does nothing once any administrator exists, so later registrations are never promoted", async () => {
    createUser("first", "x", true);
    createUser("second", "x");
    expect(await run("second", "hunter22!")).toBe("has_admin");
    expect(user("second")!.is_admin).toBe(0);
    expect(await run("newcomer", "hunter22!")).toBe("has_admin");
    expect(user("newcomer")).toBeUndefined();
  });

  it("never changes the password of an existing account", async () => {
    createUser("alice", "original-hash");
    await run("alice", "a-different-password");
    expect(user("alice")!.password_hash).toBe("original-hash");
  });

  it("won't create an account from a name or password that registration would refuse", async () => {
    expect(await run("guest_x1", "hunter22!")).toBe("invalid");
    expect(await run("a b", "hunter22!")).toBe("invalid");
    expect(getDb().prepare(`SELECT COUNT(*) FROM users`).pluck().get()).toBe(0);
  });

  it("won't promote a guest or disabled account", async () => {
    getDb().prepare(`INSERT INTO users (username, password_hash, created_at, is_guest) VALUES ('guest_ab12cd', '!', 1, 1)`).run();
    expect(await run("guest_ab12cd", "hunter22!")).toBe("invalid");
    createUser("gone", "x");
    getDb().prepare(`UPDATE users SET disabled_at = 1 WHERE username = 'gone'`).run();
    expect(await run("gone", "hunter22!")).toBe("invalid");
    expect(user("gone")!.is_admin).toBe(0);
  });
});