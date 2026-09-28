import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGame } from "@lilchess/shared";
import { openDb, closeDb, getDb } from "../connection.js";
import { applyMoveAndPersist, claimTimeoutAndPersist, getGame, insertGame } from "./games.js";

describe("claimTimeoutAndPersist", () => {
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

  it("finishes a game whose deadline has passed and persists the result", () => {
    const clock = { mode: "live" as const, initialMs: 60_000, incrementMs: 0 };
    const game = { ...createGame({ clock, now: 0 }), deadlineAt: 500 };
    insertGame("g1", 1, 2, game);

    const result = claimTimeoutAndPersist("g1", 1_000);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.status).toBe("finished");
    expect(result.state.termination).toBe("timeout");

    // Re-read from the DB, not just the in-memory result, to confirm
    // updateGameState actually persisted it.
    expect(getGame("g1")?.status).toBe("finished");
  });

  it("refuses to claim before the deadline", () => {
    const clock = { mode: "live" as const, initialMs: 60_000, incrementMs: 0 };
    const game = createGame({ clock, now: 0 }); // deadline at 60000
    insertGame("g2", 1, 2, game);

    const result = claimTimeoutAndPersist("g2", 30_000);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("not_yet_expired");
    expect(getGame("g2")?.status).toBe("started");
  });

  it("returns not_found for a game that doesn't exist", () => {
    const result = claimTimeoutAndPersist("does-not-exist", Date.now());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("not_found");
  });

  it("rejects a timeout claim against a deadline a move has already superseded", () => {
    const clock = { mode: "live" as const, initialMs: 60_000, incrementMs: 0 };
    const game = createGame({ clock, now: 0 }); // original deadline: 60000
    insertGame("g3", 1, 2, game);

    // A move lands 1s before the original deadline, advancing
    // deadline_at to roughly (59000 + black's remaining time).
    const moveResult = applyMoveAndPersist("g3", "e2e4", 59_000);
    expect(moveResult.ok).toBe(true);

    // A timeout claim carrying the ORIGINAL deadline is now stale.
    // claimTimeoutAndPersist re-reads the game fresh inside its own
    // transaction rather than trusting the caller's "now" against a
    // remembered deadline, so this correctly no-ops instead of ending
    // the game out from under the move that just landed.
    const claim = claimTimeoutAndPersist("g3", 59_999);
    expect(claim.ok).toBe(false);
    if (claim.ok) return;
    expect(claim.error).toBe("not_yet_expired");

    expect(getGame("g3")?.moves).toEqual(["e2e4"]);
    expect(getGame("g3")?.status).toBe("started");
  });
});