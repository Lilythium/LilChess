import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { closeDb, getDb, openDb } from "../db/connection.js";
import { registerUser } from "../testing/helpers.js";
import { deadlineBus } from "../game/deadlineBus.js";
import { startScheduledTournaments } from "./service.js";

describe("tournament lifecycle", () => {
  let app: FastifyInstance;
  let alice: string;
  let bob: string;
  let carol: string;

  beforeEach(async () => {
    openDb(":memory:");
    app = await buildApp();
    alice = await registerUser(app, "alice");
    bob = await registerUser(app, "bob");
    carol = await registerUser(app, "carol");
  });

  afterEach(async () => {
    await app.close();
    closeDb();
  });

  it("registers players, generates each round-robin pairing, and updates standings", async () => {
    const created = await app.inject({
      method: "POST", url: "/api/tournaments", cookies: { sessionId: alice },
      payload: { name: "Friday Swiss", mode: "live", initialMs: 300_000, incrementMs: 2, maxPlayers: 4 },
    });
    expect(created.statusCode).toBe(200);
    const id = created.json().tournamentId as string;

    const bobJoin = await app.inject({ method: "POST", url: `/api/tournaments/${id}/join`, cookies: { sessionId: bob } });
    expect(bobJoin.statusCode, bobJoin.body).toBe(200);
    expect((await app.inject({ method: "POST", url: `/api/tournaments/${id}/join`, cookies: { sessionId: carol } })).statusCode).toBe(200);
    let deadlineChanged = false;
    deadlineBus.once("changed", () => { deadlineChanged = true; });
    const started = await app.inject({ method: "POST", url: `/api/tournaments/${id}/start`, cookies: { sessionId: alice } });
    expect(started.statusCode).toBe(200);
    expect(deadlineChanged).toBe(true);
    expect(started.json().gameCount).toBe(1);

    const gameRows = getDb().prepare(`
      SELECT p.round_number, p.game_id, p.white_id, p.black_id, g.rated, g.mode
      FROM tournament_pairings p LEFT JOIN games g ON g.id = p.game_id WHERE p.tournament_id = ?
      ORDER BY p.round_number
    `).all(id) as { round_number: number; game_id: string | null; white_id: number; black_id: number; rated: number | null; mode: string | null }[];
    expect(gameRows).toHaveLength(3);
    const materialized = gameRows.filter((g) => g.game_id !== null);
    expect(materialized).toHaveLength(1);
    expect(materialized.every((g) => g.rated === 0 && g.mode === "live")).toBe(true);
    expect(gameRows.map((g) => g.round_number)).toEqual([1, 2, 3]);
    const tournamentList = await app.inject({ method: "GET", url: "/api/tournaments", cookies: { sessionId: alice } });
    expect(gameRows.map((g) => g.game_id)).toContain(tournamentList.json().tournaments[0].nextGameId);

    const sessionsByUsername = { alice, bob, carol };
    for (let round = 1; round <= 3; round++) {
      const active = getDb().prepare(`
        SELECT p.game_id AS id, p.white_id AS whiteId
        FROM tournament_pairings p JOIN games g ON g.id = p.game_id
        WHERE p.tournament_id = ? AND p.round_number = ? AND g.status = 'started'
      `).all(id, round) as { id: string; whiteId: number }[];
      expect(active).toHaveLength(1);
      const white = getDb().prepare(`SELECT username FROM users WHERE id = ?`).get(active[0]!.whiteId) as
        { username: keyof typeof sessionsByUsername };
      const ended = await app.inject({
        method: "POST", url: `/api/games/${active[0]!.id}/resign`,
        cookies: { sessionId: sessionsByUsername[white.username] },
      });
      expect(ended.statusCode).toBe(200);
      const currentRound = (getDb().prepare(`SELECT current_round AS round FROM tournaments WHERE id = ?`).get(id) as { round: number }).round;
      if (round < 3) expect(currentRound).toBe(round + 1);
    }
    const list = await app.inject({ method: "GET", url: "/api/tournaments", cookies: { sessionId: alice } });
    expect(list.json().tournaments[0].status).toBe("completed");
    const detail = await app.inject({ method: "GET", url: `/api/tournaments/${id}`, cookies: { sessionId: alice } });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().tournament.status).toBe("completed");
    expect(detail.json().standings.reduce((total: number, row: { points: number }) => total + row.points, 0)).toBe(3);
  });

  it("rejects registration after start and prevents non-organizers starting", async () => {
    const created = await app.inject({
      method: "POST", url: "/api/tournaments", cookies: { sessionId: alice },
      payload: { name: "Quick Cup", mode: "correspondence", daysPerMove: 2, maxPlayers: 3 },
    });
    const id = created.json().tournamentId as string;
    await app.inject({ method: "POST", url: `/api/tournaments/${id}/join`, cookies: { sessionId: bob } });
    expect((await app.inject({ method: "POST", url: `/api/tournaments/${id}/start`, cookies: { sessionId: bob } })).statusCode).toBe(403);
    await app.inject({ method: "POST", url: `/api/tournaments/${id}/start`, cookies: { sessionId: alice } });
    expect((await app.inject({ method: "POST", url: `/api/tournaments/${id}/join`, cookies: { sessionId: carol } })).statusCode).toBe(409);
  });

  it("starts scheduled rated tournaments and copies the rating setting to games", async () => {
    const startsAt = Date.now() + 60_000;
    const created = await app.inject({
      method: "POST", url: "/api/tournaments", cookies: { sessionId: alice },
      payload: {
        name: "Rated Cup", description: "Club night", mode: "live", initialMs: 180_000,
        incrementMs: 2_000, rated: true, maxPlayers: 4, startsAt, endsAt: startsAt + 3_600_000,
      },
    });
    expect(created.statusCode).toBe(200);
    const id = created.json().tournamentId as string;
    await app.inject({ method: "POST", url: `/api/tournaments/${id}/join`, cookies: { sessionId: bob } });
    expect((await app.inject({ method: "POST", url: `/api/tournaments/${id}/start`, cookies: { sessionId: alice } })).statusCode).toBe(409);
    expect(startScheduledTournaments(startsAt)).toEqual([id]);
    expect(getDb().prepare(`SELECT rated, mode FROM games`).get()).toEqual({ rated: 1, mode: "live" });

    const invalid = await app.inject({
      method: "POST", url: "/api/tournaments", cookies: { sessionId: alice },
      payload: {
        name: "Bad Schedule", mode: "live", initialMs: 60_000, maxPlayers: 2,
        startsAt, endsAt: startsAt - 1,
      },
    });
    expect(invalid.statusCode).toBe(400);
  });
});