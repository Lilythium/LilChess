import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { createGame, fenAfterMoves } from "@lilchess/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { closeDb, openDb } from "../db/connection.js";
import { checkIntegrity } from "../db/integrity.js";
import { applyMoveAndPersist, getGame, getMoveSans, insertGame } from "../db/repositories/games.js";
import { registerUser, startGame } from "../testing/helpers.js";

describe("variant challenges over HTTP", () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    openDb(":memory:");
    app = await buildApp();
  });
  afterEach(async () => {
    await app.close();
    closeDb();
  });

  it("a chess960 challenge becomes a chess960 game with a scrambled start", async () => {
    const alice = await registerUser(app, "alice");
    const bob = await registerUser(app, "bob");
    const gameId = await startGame(app, alice, bob, { mode: "live", initialMs: 300_000, incrementMs: 0, variant: "chess960" });
    const res = await app.inject({ method: "GET", url: `/api/games/${gameId}`, cookies: { sessionId: alice } });
    const g = res.json().game;
    expect(g.variant).toBe("chess960");
    expect(g.initialFen).toMatch(/^[bnrqk]{8}\/pppppppp\/8\/8\/8\/8\/PPPPPPPP\/[BNRQK]{8} w KQkq - 0 1$/);
    expect(fenAfterMoves(g.initialFen, [])).not.toBeNull();
  });

  it("defaults to standard and rejects unknown variants", async () => {
    const alice = await registerUser(app, "alice");
    const bob = await registerUser(app, "bob");
    const gameId = await startGame(app, alice, bob);
    const res = await app.inject({ method: "GET", url: `/api/games/${gameId}`, cookies: { sessionId: alice } });
    expect(res.json().game.variant).toBe("standard");

    const bad = await app.inject({
      method: "POST", url: "/api/challenges", cookies: { sessionId: alice },
      payload: { mode: "live", initialMs: 300_000, incrementMs: 0, variant: "atomic" },
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe("chess960 persistence", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "lilchess-960-")); });
  afterEach(() => {
    closeDb();
    rmSync(dir, { recursive: true, force: true });
  });

  it("survives a restart, including a king-takes-rook castle in the history", () => {
    const path = join(dir, "lilchess.db");
    const FEN = "4k3/8/8/8/8/8/8/R1K4R w KQ - 0 1";
    const now = Date.now();

    const db = openDb(path);
    db.exec(`INSERT INTO users (id, username, password_hash, created_at) VALUES (1,'alice','x',0),(2,'bob','x',0)`);
    insertGame("g1", 1, 2, createGame({
      clock: { mode: "live", initialMs: 60_000, incrementMs: 0 }, variant: "chess960", initialFen: FEN, now,
    }));
    expect(applyMoveAndPersist("g1", "c1h1", now + 1_000).ok).toBe(true);
    closeDb(); // "restart"

    const db2 = openDb(path);
    const g = getGame("g1")!;
    expect(g.variant).toBe("chess960");
    expect(g.initialFen).toBe(FEN);
    expect(g.moves).toEqual(["c1h1"]);
    expect(getMoveSans("g1")).toEqual(["O-O"]);
    expect(applyMoveAndPersist("g1", "e8e7", now + 2_000).ok).toBe(true); // replays the castle from history
    expect(checkIntegrity(db2, { deep: true })).toEqual([]);
  });
});