import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGame } from "@lilchess/shared";
import { openDb, closeDb, getDb } from "../connection.js";
import {
  acceptTakebackAndPersist,
  applyMoveAndPersist,
  claimTimeoutAndPersist,
  getGame,
  getMoveSans,
  insertGame,
  offerTakebackAndPersist,
} from "./games.js";

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
    // ply 2: both sides have moved, so the real clock is running
    const game = { ...createGame({ clock, now: 0 }), ply: 2, deadlineAt: 500 };
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
    const game = createGame({ clock, now: 0 }); // first-move window ends at 30000
    insertGame("g2", 1, 2, game);

    const result = claimTimeoutAndPersist("g2", 10_000);
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
    const game = createGame({ clock, now: 0 }); // original first-move deadline: 30000
    insertGame("g3", 1, 2, game);

    // White moves at 20s, which gives black a fresh window ending at 50000.
    const moveResult = applyMoveAndPersist("g3", "e2e4", 20_000);
    expect(moveResult.ok).toBe(true);

    // A timeout claim carrying the ORIGINAL deadline is now stale.
    // claimTimeoutAndPersist re-reads the game fresh inside its own
    // transaction rather than trusting the caller's "now" against a
    // remembered deadline, so this correctly no-ops instead of ending
    // the game out from under the move that just landed.
    const claim = claimTimeoutAndPersist("g3", 30_001);
    expect(claim.ok).toBe(false);
    if (claim.ok) return;
    expect(claim.error).toBe("not_yet_expired");

    expect(getGame("g3")?.moves).toEqual(["e2e4"]);
    expect(getGame("g3")?.status).toBe("started");
  });

  it("aborts a live game nobody moved in, instead of awarding a timeout win", () => {
    const clock = { mode: "live" as const, initialMs: 60_000, incrementMs: 0 };
    insertGame("g4", 1, 2, createGame({ clock, now: 0 })); // window ends at 30000

    const result = claimTimeoutAndPersist("g4", 31_000);
    expect(result.ok).toBe(true);
    expect(getGame("g4")?.status).toBe("aborted");
    expect(getGame("g4")?.termination).toBe("abort");
    expect(getGame("g4")?.result).toBeUndefined();
  });
});

describe("takebacks", () => {
  beforeEach(() => {
    // Mock the system time so that acceptance checks don't instantly timeout
    vi.useFakeTimers();
    vi.setSystemTime(1500); 

    openDb(":memory:");
    const db = getDb();
    db.prepare(`INSERT INTO users (id, username, password_hash, created_at) VALUES (1, 'alice', 'x', 0)`).run();
    db.prepare(`INSERT INTO users (id, username, password_hash, created_at) VALUES (2, 'bob', 'x', 0)`).run();
    const clock = { mode: "live" as const, initialMs: 60_000, incrementMs: 0 };
    insertGame("tb1", 1, 2, createGame({ clock, now: 0 })); // alice = white
  });

  afterEach(() => {
    closeDb();
    vi.useRealTimers();
  });

  it("removes the retracted move and restores the turn", () => {
    expect(applyMoveAndPersist("tb1", "e2e4", 1_000).ok).toBe(true);
    expect(offerTakebackAndPersist("tb1", 1).ok).toBe(true);
    expect(getGame("tb1")?.takebackOfferedBy).toBe("white");

    expect(acceptTakebackAndPersist("tb1", 2).ok).toBe(true);

    const g = getGame("tb1")!;
    expect(g.moves).toEqual([]);
    expect(g.ply).toBe(0);
    expect(g.turn).toBe("white");
    expect(g.takebackOfferedBy).toBeUndefined();
    expect(getMoveSans("tb1")).toEqual([]);
  });

  it("lets the game continue with a different move afterwards", () => {
    applyMoveAndPersist("tb1", "e2e4", 1_000);
    offerTakebackAndPersist("tb1", 1);
    acceptTakebackAndPersist("tb1", 2);

    const res = applyMoveAndPersist("tb1", "d2d4", 2_000);
    expect(res.ok).toBe(true);
    expect(getGame("tb1")?.moves).toEqual(["d2d4"]);
    expect(getMoveSans("tb1")).toEqual(["d4"]);
  });

  it("refuses an offer before the requester has moved", () => {
    const res = offerTakebackAndPersist("tb1", 1);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("nothing_to_take_back");
  });

  it("only participants can offer", () => {
    const res = offerTakebackAndPersist("tb1", 99);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("not_a_participant");
  });
});