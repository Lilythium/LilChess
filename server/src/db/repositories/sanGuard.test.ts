import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lilchess/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lilchess/shared")>();
  return { ...actual, sanForNextMove: vi.fn(actual.sanForNextMove) };
});

import { createGame, sanForNextMove } from "@lilchess/shared";
import { buildApp } from "../../app.js";
import { registerUser, startGame } from "../../testing/helpers.js";
import { closeDb, getDb, openDb } from "../connection.js";
import { applyMoveAndPersist, getGame, getMoveSans, insertGame } from "./games.js";

const CLOCK = { mode: "live" as const, initialMs: 60_000, incrementMs: 0 };

describe("a move that can't produce SAN (repository)", () => {
  beforeEach(() => {
    openDb(":memory:");
    const db = getDb();
    db.prepare(`INSERT INTO users (id, username, password_hash, created_at) VALUES (1, 'alice', 'x', 0)`).run();
    db.prepare(`INSERT INTO users (id, username, password_hash, created_at) VALUES (2, 'bob', 'x', 0)`).run();
  });
  afterEach(() => {
    closeDb();
    vi.mocked(sanForNextMove).mockClear();
  });

  it("throws and leaves ply, moves and the game row untouched", () => {
    insertGame("g1", 1, 2, createGame({ clock: CLOCK, now: 0 }));
    vi.mocked(sanForNextMove).mockReturnValueOnce(null);

    expect(() => applyMoveAndPersist("g1", "e2e4", 1_000)).toThrow(/no SAN/);
    const g = getGame("g1")!;
    expect(g.ply).toBe(0);
    expect(g.moves).toEqual([]);
    expect(getMoveSans("g1")).toEqual([]);

    // the same move goes through once SAN works again
    expect(applyMoveAndPersist("g1", "e2e4", 1_000).ok).toBe(true);
    expect(getGame("g1")?.moves).toEqual(["e2e4"]);
    expect(getMoveSans("g1")).toEqual(["e4"]);
  });

  it("does not need SAN when a late move just ends the game on time", () => {
    insertGame("g2", 1, 2, { ...createGame({ clock: CLOCK, now: 0 }), ply: 2, deadlineAt: 500 });
    const res = applyMoveAndPersist("g2", "g1f3", 1_000);
    expect(res.ok).toBe(true);
    expect(getGame("g2")?.termination).toBe("timeout");
    expect(sanForNextMove).not.toHaveBeenCalled();
  });
});

describe("a move that can't produce SAN (HTTP)", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    openDb(":memory:");
    app = await buildApp();
  });
  afterEach(async () => {
    await app.close();
    closeDb();
    vi.mocked(sanForNextMove).mockClear();
  });

  it("500s, persists nothing, and an identical retry succeeds", async () => {
    const alice = await registerUser(app, "alice");
    const bob = await registerUser(app, "bob");
    const gameId = await startGame(app, alice, bob);
    const move = () =>
      app.inject({
        method: "POST",
        url: `/api/games/${gameId}/move`,
        cookies: { sessionId: alice },
        payload: { ply: 0, uci: "e2e4" },
      });

    vi.mocked(sanForNextMove).mockReturnValueOnce(null);
    const failed = await move();
    expect(failed.statusCode).toBe(500);
    expect(failed.json()).toEqual({ error: "Internal server error" });

    const state = await app.inject({ method: "GET", url: `/api/games/${gameId}`, cookies: { sessionId: alice } });
    expect(state.json().game.ply).toBe(0);
    expect(state.json().sans).toEqual([]);

    expect((await move()).statusCode).toBe(200);
  });
});