import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { closeDb, getDb, openDb } from "../db/connection.js";
import { registerUser } from "../testing/helpers.js";
import { periodBoards, topPlayers } from "./queries.js";

const DAY = 86_400_000;
const NOW = Date.now();
const OPTS = { minGames: 5, inactiveDays: 30, now: NOW };

let app: FastifyInstance;
let histN = 0;

async function user(name: string): Promise<{ id: number; sid: string }> {
  const sid = await registerUser(app, name);
  const row = getDb().prepare(`SELECT id FROM users WHERE username = ?`).get(name) as { id: number };
  return { id: row.id, sid };
}

/** Inserts a user directly. Registering over HTTP is rate-limited to 10 per hour per IP. */
function seedUser(name: string): number {
  const res = getDb()
    .prepare(`INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', ?)`)
    .run(name, NOW);
  return Number(res.lastInsertRowid);
}

function rate(userId: number, variant: string, rating: number, games: number, lastGameAt: number) {
  getDb()
    .prepare(
      `INSERT INTO ratings (user_id, variant, rating, rd, volatility, games, last_game_at)
       VALUES (?, ?, ?, 80, 0.06, ?, ?)`,
    )
    .run(userId, variant, rating, games, lastGameAt);
}

function hist(userId: number, variant: string, before: number, after: number, createdAt: number) {
  getDb()
    .prepare(
      `INSERT INTO rating_history (game_id, user_id, variant, opponent_id, opponent_rating, score,
         rating_before, rd_before, rating_after, rd_after, volatility_after, created_at)
       VALUES (?, ?, ?, ?, 1500, 1, ?, 80, ?, 80, 0.06, ?)`,
    )
    .run(`seed${histN++}`, userId, variant, userId, before, after, createdAt);
}

beforeEach(async () => {
  openDb(":memory:");
  getDb().pragma("foreign_keys = OFF"); // seed rating rows without building real games
  app = await buildApp();
});
afterEach(async () => {
  await app.close();
  closeDb();
});

describe("topPlayers", () => {
  it("ranks by rating and applies the min-games, inactivity, guest and variant filters", async () => {
    const a = await user("alice");
    const b = await user("bob");
    const c = await user("carol");
    const d = await user("dave");
    const e = await user("erin");
    const f = await user("frank");
    getDb().prepare(`UPDATE users SET is_guest = 1 WHERE id = ?`).run(f.id);

    rate(a.id, "standard", 1700, 20, NOW - DAY);
    rate(b.id, "standard", 1800, 20, NOW - DAY);
    rate(c.id, "standard", 1900, 2, NOW - DAY);          // too few games
    rate(d.id, "standard", 2000, 20, NOW - 45 * DAY);    // inactive
    rate(e.id, "chess960", 2100, 20, NOW - DAY);         // other variant
    rate(f.id, "standard", 2200, 20, NOW - DAY);         // guest

    const { players, ranked } = topPlayers("standard", OPTS);
    expect(players.map((p) => p.username)).toEqual(["bob", "alice"]);
    expect(players.map((p) => p.rank)).toEqual([1, 2]);
    expect(ranked).toBe(2);
    expect(topPlayers("chess960", OPTS).players.map((p) => p.username)).toEqual(["erin"]);
  });

  it("inactiveDays = 0 keeps long-idle players", async () => {
    const d = await user("dave");
    rate(d.id, "standard", 2000, 20, NOW - 400 * DAY);
    expect(topPlayers("standard", { ...OPTS, inactiveDays: 0 }).players).toHaveLength(1);
  });

  it("returns at most 10 but reports the full ranked count", () => {
    for (let i = 0; i < 12; i++) {
      rate(seedUser(`player${i}`), "standard", 1500 + i, 10, NOW - DAY);
    }
    const { players, ranked } = topPlayers("standard", OPTS);
    expect(players).toHaveLength(10);
    expect(ranked).toBe(12);
    expect(players[0]!.username).toBe("player11");
  });
});

describe("periodBoards", () => {
  it("computes gain from the first rating_before to the last rating_after inside the window", async () => {
    const a = await user("alice"); // +100 inside the week
    const b = await user("bob");   // net loss: excluded
    const c = await user("carol"); // only 2 games in window: excluded
    const d = await user("dave");  // one game 10 days ago, then +30 this week
    for (const u of [a, b, c, d]) rate(u.id, "standard", 1600, 10, NOW - DAY);

    hist(a.id, "standard", 1500, 1520, NOW - 3 * DAY);
    hist(a.id, "standard", 1520, 1560, NOW - 2 * DAY);
    hist(a.id, "standard", 1560, 1600, NOW - 1 * DAY);

    hist(b.id, "standard", 1600, 1590, NOW - 3 * DAY);
    hist(b.id, "standard", 1590, 1580, NOW - 2 * DAY);
    hist(b.id, "standard", 1580, 1570, NOW - 1 * DAY);

    hist(c.id, "standard", 1500, 1550, NOW - 2 * DAY);
    hist(c.id, "standard", 1550, 1600, NOW - 1 * DAY);

    hist(d.id, "standard", 1400, 1450, NOW - 10 * DAY);
    hist(d.id, "standard", 1450, 1460, NOW - 3 * DAY);
    hist(d.id, "standard", 1460, 1470, NOW - 2 * DAY);
    hist(d.id, "standard", 1470, 1480, NOW - 1 * DAY);

    const week = periodBoards("standard", "week", OPTS).improved;
    expect(week.map((m) => [m.username, m.gain])).toEqual([["alice", 100], ["dave", 30]]);

    const month = periodBoards("standard", "month", OPTS).improved;
    expect(month.find((m) => m.username === "dave")).toMatchObject({ gain: 80, from: 1400, to: 1480, games: 4 });
  });

  it("most active counts rated games inside the window", async () => {
    const a = await user("alice");
    const b = await user("bob");
    rate(a.id, "standard", 1500, 10, NOW);
    rate(b.id, "standard", 1500, 10, NOW);
    for (let i = 0; i < 4; i++) hist(a.id, "standard", 1500, 1500, NOW - DAY);
    for (let i = 0; i < 2; i++) hist(b.id, "standard", 1500, 1500, NOW - DAY);
    hist(b.id, "standard", 1500, 1500, NOW - 60 * DAY); // outside the week
    const { active } = periodBoards("standard", "week", OPTS);
    expect(active.map((p) => [p.username, p.games])).toEqual([["alice", 4], ["bob", 2]]);
  });

  it("is scoped to one variant", async () => {
    const a = await user("alice");
    rate(a.id, "standard", 1500, 10, NOW);
    for (let i = 0; i < 3; i++) hist(a.id, "chess960", 1500, 1510 + i, NOW - DAY);
    expect(periodBoards("standard", "week", OPTS).active).toEqual([]);
  });
});

describe("GET /api/leaderboard/:variant", () => {
  it("requires login", async () => {
    const res = await app.inject({ method: "GET", url: "/api/leaderboard/standard" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects an unknown variant or period", async () => {
    const { sid } = await user("alice");
    const badVariant = await app.inject({ method: "GET", url: "/api/leaderboard/crazyhouse", cookies: { sessionId: sid } });
    expect(badVariant.statusCode).toBe(400);
    const badPeriod = await app.inject({ method: "GET", url: "/api/leaderboard/standard?period=decade", cookies: { sessionId: sid } });
    expect(badPeriod.statusCode).toBe(400);
  });

  it("returns empty boards on a fresh database, defaulting to the week window", async () => {
    const { sid } = await user("alice");
    const res = await app.inject({ method: "GET", url: "/api/leaderboard/standard", cookies: { sessionId: sid } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, variant: "standard", period: "week", ranked: 0, top: [], improved: [], active: [] });
  });
});