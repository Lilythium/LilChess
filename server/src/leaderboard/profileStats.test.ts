import type { FastifyInstance } from "fastify";
import { VARIANTS } from "@lilchess/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { closeDb, getDb, openDb } from "../db/connection.js";
import { computeRecentDelta, getPlayerRatings } from "../db/repositories/ratings.js";
import { registerUser, startGame } from "../testing/helpers.js";
import { ratingPercentile } from "./queries.js";

const DAY = 86_400_000;
const NOW = Date.now();
const OPTS = { minGames: 5, inactiveDays: 30, now: NOW };

let app: FastifyInstance;
let seq = 0;

const call = (sid: string, url: string) => app.inject({ method: "GET", url, cookies: { sessionId: sid } });

function seedUser(name: string): number {
  return Number(
    getDb().prepare(`INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', ?)`).run(name, NOW)
      .lastInsertRowid,
  );
}

function rate(userId: number, variant: string, rating: number, games: number, lastGameAt = NOW) {
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
    .run(`seed${seq++}`, userId, variant, userId, before, after, createdAt);
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

describe("getPlayerRatings", () => {
  it("returns one entry per variant the server supports, including ones never played", () => {
    const id = seedUser("alice");
    rate(id, "standard", 1620, 30);
    const list = getPlayerRatings(id, NOW);
    expect(list.map((r) => r.variant)).toEqual([...VARIANTS]);
    expect(list[0]).toMatchObject({ variant: "standard", label: "Standard", rating: 1620, games: 30 });
    const unplayed = list.find((r) => r.variant === "chess960")!;
    expect(unplayed).toMatchObject({ games: 0, provisional: true, delta: 0 });
  });
});

describe("computeRecentDelta", () => {
  it("is 0 with no history, spans fewer than 12 games, and only looks at the last 12", () => {
    const id = seedUser("alice");
    expect(computeRecentDelta(id, "standard")).toBe(0);

    hist(id, "standard", 1500, 1510, 1);
    hist(id, "standard", 1510, 1495, 2);
    expect(computeRecentDelta(id, "standard")).toBe(-5); // 1495 - 1500

    for (let i = 0; i < 20; i++) hist(id, "standard", 1495 + i * 10, 1495 + (i + 1) * 10, 10 + i);
    expect(computeRecentDelta(id, "standard")).toBe(120); // 12 games x +10
    expect(computeRecentDelta(id, "chess960")).toBe(0); // other variants are separate
  });
});

describe("recent_delta stays current as rated games finish", () => {
  it("is stored on the ratings row and returned by the profile", async () => {
    getDb().pragma("foreign_keys = ON");
    const alice = await registerUser(app, "alice");
    const bob = await registerUser(app, "bob");

    const play = async () => {
      const gameId = await startGame(app, alice, bob);
      getDb().prepare(`UPDATE games SET rated = 1 WHERE id = ?`).run(gameId); // challenges can't be rated yet
      const res = await app.inject({ method: "POST", url: `/api/games/${gameId}/resign`, cookies: { sessionId: bob } });
      expect(res.statusCode, res.body).toBe(200);
    };

    await play();
    const rows = getDb()
      .prepare(`SELECT u.username, r.recent_delta, r.rating FROM ratings r JOIN users u ON u.id = r.user_id`)
      .all() as { username: string; recent_delta: number; rating: number }[];
    const a1 = rows.find((r) => r.username === "alice")!;
    const b1 = rows.find((r) => r.username === "bob")!;
    expect(a1.recent_delta).toBeGreaterThan(0);
    expect(b1.recent_delta).toBeLessThan(0);
    expect(a1.recent_delta).toBe(Math.round(a1.rating) - 1500);

    await play();
    const a2 = getDb()
      .prepare(`SELECT recent_delta, rating FROM ratings WHERE user_id = (SELECT id FROM users WHERE username = 'alice')`)
      .get() as { recent_delta: number; rating: number };
    expect(a2.recent_delta).toBe(Math.round(a2.rating) - 1500); // both games are inside the 12-game window
    expect(a2.recent_delta).toBeGreaterThan(a1.recent_delta);

    const profile = (await call(bob, "/api/users/alice")).json();
    const std = profile.ratings.find((r: { variant: string }) => r.variant === "standard");
    expect(std).toMatchObject({ games: 2, delta: a2.recent_delta });
  });
});

describe("ratingPercentile", () => {
  it("is the share of other ranked players the user out-rates (floored)", () => {
    const me = seedUser("me");
    rate(me, "standard", 1600, 10);
    for (const [i, r] of [1400, 1500, 1550, 1700].entries()) rate(seedUser(`p${i}`), "standard", r, 10);
    // Players who don't count: too few games, inactive, guest, other variant.
    rate(seedUser("newbie"), "standard", 1000, 2);
    rate(seedUser("idle"), "standard", 1000, 10, NOW - 60 * DAY);
    const guest = seedUser("guest_zzzzzz");
    getDb().prepare(`UPDATE users SET is_guest = 1 WHERE id = ?`).run(guest);
    rate(guest, "standard", 1000, 10);
    rate(seedUser("other"), "chess960", 1000, 10);

    expect(ratingPercentile("standard", me, OPTS)).toEqual({ percentile: 75, pool: 4 }); // beats 3 of 4
  });

  it("is null while the player's own rating is provisional, or when nobody else is ranked", () => {
    const me = seedUser("me");
    rate(me, "standard", 1600, 2);
    rate(seedUser("other"), "standard", 1500, 10);
    expect(ratingPercentile("standard", me, OPTS).percentile).toBeNull(); // me: under minGames

    const solo = seedUser("solo");
    rate(solo, "chess960", 1600, 10);
    expect(ratingPercentile("chess960", solo, OPTS)).toEqual({ percentile: null, pool: 0 });
    expect(ratingPercentile("standard", seedUser("never"), OPTS).percentile).toBeNull(); // no ratings row
  });

  it("never reports 100% while someone is rated at or above the player", () => {
    const me = seedUser("me");
    rate(me, "standard", 1600, 10);
    rate(seedUser("tie"), "standard", 1600, 10);
    expect(ratingPercentile("standard", me, OPTS).percentile).toBe(0);
  });
});

describe("GET /api/users/:username (profile)", () => {
  it("lists every variant with delta and percentile fields", async () => {
    const alice = await registerUser(app, "alice");
    const res = await call(alice, "/api/users/alice");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ratings.map((r: { variant: string }) => r.variant)).toEqual([...VARIANTS]);
    expect(body.ratings[0]).toMatchObject({ delta: 0, percentile: null, games: 0 });
    expect(body.history).toBeUndefined(); // moved to /rating-history
  });
});

describe("GET /api/users/:username/rating-history", () => {
  async function seeded() {
    const alice = await registerUser(app, "alice");
    const id = (getDb().prepare(`SELECT id FROM users WHERE username = 'alice'`).get() as { id: number }).id;
    hist(id, "standard", 1500, 1510, NOW - 200 * DAY);
    hist(id, "standard", 1510, 1520, NOW - 60 * DAY);
    hist(id, "standard", 1520, 1530, NOW - 5 * DAY);
    hist(id, "chess960", 1500, 1480, NOW - 5 * DAY);
    return alice;
  }

  it("defaults to standard over 3 months, oldest first", async () => {
    const sid = await seeded();
    const body = (await call(sid, "/api/users/alice/rating-history")).json();
    expect(body).toMatchObject({ variant: "standard", range: "3m" });
    expect(body.points.map((p: { rating: number }) => p.rating)).toEqual([1520, 1530]);
  });

  it("honours range and variant", async () => {
    const sid = await seeded();
    const all = (await call(sid, "/api/users/alice/rating-history?range=all")).json();
    expect(all.points.map((p: { rating: number }) => p.rating)).toEqual([1510, 1520, 1530]);
    const month = (await call(sid, "/api/users/alice/rating-history?range=1m")).json();
    expect(month.points.map((p: { rating: number }) => p.rating)).toEqual([1530]);
    const c960 = (await call(sid, "/api/users/alice/rating-history?variant=chess960&range=1y")).json();
    expect(c960.points.map((p: { rating: number }) => p.rating)).toEqual([1480]);
  });

  it("is case-insensitive on the name, 404s for unknown users and 400s on bad input", async () => {
    const sid = await seeded();
    expect((await call(sid, "/api/users/ALICE/rating-history")).statusCode).toBe(200);
    expect((await call(sid, "/api/users/nobody/rating-history")).statusCode).toBe(404);
    expect((await call(sid, "/api/users/alice/rating-history?variant=bogus")).statusCode).toBe(400);
    expect((await call(sid, "/api/users/alice/rating-history?range=forever")).statusCode).toBe(400);
  });

  it("requires login", async () => {
    expect((await app.inject({ method: "GET", url: "/api/users/alice/rating-history" })).statusCode).toBe(401);
  });
});
