import type { FastifyInstance } from "fastify";
import { LIVE_TC_LIMITS } from "@lilchess/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { closeDb, openDb } from "../db/connection.js";
import { registerUser } from "../testing/helpers.js";

const MIN = 60_000;
const HOUR = 60 * MIN;

describe("custom live time controls (anything under 6 hours)", () => {
  let app: FastifyInstance;
  let sid: string;
  const post = (url: string, payload: object) =>
    app.inject({ method: "POST", url, cookies: { sessionId: sid }, payload });

  beforeEach(async () => {
    openDb(":memory:");
    app = await buildApp();
    sid = await registerUser(app, "alice");
  });
  afterEach(async () => {
    await app.close();
    closeDb();
  });

  it("sets the bounds at 10 seconds up to just under 6 hours, increment up to 3 minutes", () => {
    expect(LIVE_TC_LIMITS.minInitialMs).toBe(10_000);
    expect(LIVE_TC_LIMITS.maxInitialMs).toBeLessThan(6 * HOUR);
    expect(LIVE_TC_LIMITS.maxInitialMs).toBeGreaterThanOrEqual(5 * HOUR + 59 * MIN);
    expect(LIVE_TC_LIMITS.maxIncrementMs).toBe(3 * MIN);
  });

  describe("challenges", () => {
    const body = (initialMs: number, incrementMs = 0) => ({ mode: "live", initialMs, incrementMs });

    it("accepts a 5h 59m clock and a 3 minute increment", async () => {
      expect((await post("/api/challenges", body(5 * HOUR + 59 * MIN, 3 * MIN))).statusCode).toBe(200);
    });
    it("accepts an odd custom clock like 7+11", async () => {
      expect((await post("/api/challenges", body(7 * MIN, 11_000))).statusCode).toBe(200);
    });
    it("rejects 6 hours, below 10 seconds, and an increment over 3 minutes", async () => {
      expect((await post("/api/challenges", body(6 * HOUR))).statusCode).toBe(400);
      expect((await post("/api/challenges", body(9_000))).statusCode).toBe(400);
      expect((await post("/api/challenges", body(MIN, 3 * MIN + 1000))).statusCode).toBe(400);
    });
  });

  describe("tournaments", () => {
    const body = (initialMs: number, incrementMs = 0) => ({
      name: "Custom clock cup", mode: "live", initialMs, incrementMs, maxPlayers: 4,
    });
    it("accepts custom clocks under 6 hours and rejects longer ones", async () => {
      expect((await post("/api/tournaments", body(2 * HOUR, 90_000))).statusCode).toBe(200);
      expect((await post("/api/tournaments", body(6 * HOUR))).statusCode).toBe(400);
    });
  });

  describe("simuls", () => {
    const body = (initialMs: number, incrementMs = 0) => ({
      name: "Custom clock simul", mode: "live", initialMs, incrementMs, maxPlayers: 4,
    });
    it("accepts custom clocks under 6 hours and rejects longer ones", async () => {
      expect((await post("/api/simuls", body(3 * HOUR, 30_000))).statusCode).toBe(200);
      expect((await post("/api/simuls", body(6 * HOUR))).statusCode).toBe(400);
    });
  });
});
