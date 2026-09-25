import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGame } from "@lilchess/shared";
import { openDb, closeDb, getDb } from "../connection.js";
import { insertGame, getGame, applyMoveAndPersist } from "./games.js";

describe("games persistence", () => {
  beforeEach(() => {
    openDb(":memory:");
    const db = getDb();
    db.prepare(
      `INSERT INTO users (id, username, password_hash, created_at) VALUES (1, 'alice', 'x', 0)`,
    ).run();
    db.prepare(
      `INSERT INTO users (id, username, password_hash, created_at) VALUES (2, 'bob', 'x', 0)`,
    ).run();
  });

  afterEach(() => closeDb());

  it("creates a game, applies moves through the core, and reads it back", () => {
    const clock = { mode: "live" as const, initialMs: 60_000, incrementMs: 0 };
    const game = createGame({ clock, now: 0 });
    insertGame("g1", 1, 2, game);

    applyMoveAndPersist("g1", "e2e4", 1_000);
    applyMoveAndPersist("g1", "e7e5", 2_000);

    const loaded = getGame("g1");
    expect(loaded?.moves).toEqual(["e2e4", "e7e5"]);
    expect(loaded?.turn).toBe("white");
    expect(loaded?.status).toBe("started");
  });
});