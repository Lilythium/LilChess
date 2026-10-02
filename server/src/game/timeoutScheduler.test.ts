import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGame } from "@lilchess/shared";
import { openDb, closeDb, getDb } from "../db/connection.js";
import { insertGame, getGame } from "../db/repositories/games.js";
import { notifyDeadlineChanged } from "./deadlineBus.js";
import { startTimeoutScheduler, stopTimeoutScheduler, delayFor } from "./timeoutScheduler.js";

describe("delayFor", () => {
  it("caps far-off deadlines at 30s", () => {
    expect(delayFor(10 * 60_000)).toBe(30_000);
  });

  it("caps delay at 2s when between 10s and 60s remaining", () => {
    expect(delayFor(20_000)).toBe(2_000);
  });

  it("does not wait longer than msUntil when msUntil is smaller than 100ms", () => {
    expect(delayFor(80)).toBe(80); 
  });

  it("tightens to 2s inside a minute", () => {
    expect(delayFor(45_000)).toBe(2_000);
  });

  it("tightens to 500ms inside 10s", () => {
    expect(delayFor(5_000)).toBe(500);
  });

  it("tightens toward ~100ms inside 2s, floored at 50ms", () => {
    expect(delayFor(1_000)).toBe(100);
    expect(delayFor(10)).toBe(50);
  });

  it("returns 0 for a deadline that has already passed", () => {
    expect(delayFor(0)).toBe(0);
    expect(delayFor(-5)).toBe(0);
  });
});

function seedUsers(): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO users (id, username, password_hash, created_at) VALUES (1, 'alice', 'x', 0)`,
  ).run();
  db.prepare(
    `INSERT INTO users (id, username, password_hash, created_at) VALUES (2, 'bob', 'x', 0)`,
  ).run();
}

// A live game whose real clock is running (both sides have moved).
function runningGame(deadlineAt: number) {
  const clock = { mode: "live" as const, initialMs: 60_000, incrementMs: 0 };
  return { ...createGame({ clock, now: Date.now() - 120_000 }), ply: 2, deadlineAt };
}

describe("timeout scheduler — startup sweep", () => {
  beforeEach(() => {
    openDb(":memory:");
    seedUsers();
  });

  afterEach(() => {
    stopTimeoutScheduler();
    closeDb();
  });

  it("settles a game whose deadline already passed before the scheduler started", () => {
    insertGame("expired-1", 1, 2, runningGame(Date.now() - 10_000));

    startTimeoutScheduler();

    const settled = getGame("expired-1");
    expect(settled?.status).toBe("finished");
    expect(settled?.termination).toBe("timeout");
    expect(settled?.result).toBe("0-1"); // white was to move and flagged
  });

  it("leaves a game with a future deadline untouched", () => {
    const clock = { mode: "live" as const, initialMs: 60_000, incrementMs: 0 };
    const game = createGame({ clock, now: Date.now() });
    insertGame("active-1", 1, 2, game);

    startTimeoutScheduler();

    expect(getGame("active-1")?.status).toBe("started");
  });

  it("settles every game that's expired, not just the earliest", () => {
    insertGame("expired-a", 1, 2, runningGame(Date.now() - 20_000));
    insertGame("expired-b", 1, 2, runningGame(Date.now() - 5_000));

    startTimeoutScheduler();

    expect(getGame("expired-a")?.status).toBe("finished");
    expect(getGame("expired-b")?.status).toBe("finished");
  });

  it("aborts a live game that nobody moved in", () => {
    const clock = { mode: "live" as const, initialMs: 60_000, incrementMs: 0 };
    insertGame("idle-1", 1, 2, {
      ...createGame({ clock, now: Date.now() - 120_000 }),
      deadlineAt: Date.now() - 10_000, // first-move window long gone
    });
    startTimeoutScheduler();
    const settled = getGame("idle-1");
    expect(settled?.status).toBe("aborted");
    expect(settled?.termination).toBe("abort");
    expect(settled?.result).toBeUndefined();
  });
});

describe("timeout scheduler — wakes on deadlineBus", () => {
  beforeEach(() => {
    openDb(":memory:");
    seedUsers();
  });

  afterEach(() => {
    stopTimeoutScheduler();
    closeDb();
  });

  it("settles a newly-inserted expired game as soon as it's woken, without waiting for the idle poll", () => {
    startTimeoutScheduler();

    insertGame("late-insert", 1, 2, runningGame(Date.now() - 1));

    notifyDeadlineChanged();

    expect(getGame("late-insert")?.status).toBe("finished");
  });
});