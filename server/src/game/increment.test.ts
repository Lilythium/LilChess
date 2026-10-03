import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import { closeDb, openDb } from "../db/connection.js";
import { registerUser, startGame } from "../testing/helpers.js";

const T0 = 1_800_000_000_000;

describe("increment through HTTP and the database (5+3)", () => {
  let app: FastifyInstance;
  let alice: string;
  let bob: string;
  let gameId: string;

  const move = (sid: string, at: number, ply: number, uci: string) => {
    vi.setSystemTime(at);
    return app.inject({
      method: "POST",
      url: `/api/games/${gameId}/move`,
      cookies: { sessionId: sid },
      payload: { ply, uci },
    });
  };
  const state = async () =>
    (await app.inject({ method: "GET", url: `/api/games/${gameId}`, cookies: { sessionId: alice } })).json().game;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); // only Date, so inject and sqlite keep working
    vi.setSystemTime(T0);
    openDb(":memory:");
    app = await buildApp();
    alice = await registerUser(app, "alice");
    bob = await registerUser(app, "bob");
    gameId = await startGame(app, alice, bob, { mode: "live", initialMs: 300_000, incrementMs: 3_000 });
  });
  afterEach(async () => {
    await app.close();
    closeDb();
    vi.useRealTimers();
  });

  it("adds the increment on each side's second move and persists it", async () => {
    expect((await move(alice, T0, 0, "e2e4")).statusCode).toBe(200);
    expect((await move(bob, T0 + 1_000, 1, "e7e5")).statusCode).toBe(200);
    let g = await state();
    expect(g.whiteMs).toBe(300_000); // first moves: free, no increment
    expect(g.blackMs).toBe(300_000);

    expect((await move(alice, T0 + 6_000, 2, "g1f3")).statusCode).toBe(200); // thought 5s
    g = await state();
    expect(g.whiteMs).toBe(298_000); // 300000 - 5000 + 3000
    expect(g.blackMs).toBe(300_000);
    expect(g.deadlineAt).toBe(T0 + 6_000 + 300_000);

    expect((await move(bob, T0 + 9_000, 3, "b8c6")).statusCode).toBe(200); // thought 3s
    g = await state();
    expect(g.blackMs).toBe(300_000); // 300000 - 3000 + 3000
    expect(g.whiteMs).toBe(298_000);
    expect(g.deadlineAt).toBe(T0 + 9_000 + 298_000);
  });
});