import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { closeDb, getDb, openDb } from "../db/connection.js";
import { registerUser } from "../testing/helpers.js";

let app: FastifyInstance;
const sids: Record<string, string> = {};
const NAMES = ["alice", "bob", "carol", "dave"];

const uid = (name: string) => getDb().prepare(`SELECT id FROM users WHERE username = ?`).pluck().get(name) as number;
const nameOf = (id: number) => getDb().prepare(`SELECT username FROM users WHERE id = ?`).pluck().get(id) as string;
const call = (method: "GET" | "POST", url: string, user: string, payload?: object) =>
  app.inject({ method, url, cookies: { sessionId: sids[user]! }, payload });
const detail = async (id: string) => (await call("GET", `/api/tournaments/${id}`, "alice")).json();

async function simul2(players: string[], extra: Record<string, unknown> = {}): Promise<string> {
  const created = await call("POST", "/api/tournaments", players[0]!, {
    name: "Simul2 cup", format: "simul2", maxPlayers: 12, mode: "live", initialMs: 300_000, incrementMs: 0, ...extra,
  });
  expect(created.statusCode, created.body).toBe(200);
  const id = created.json().tournamentId as string;
  for (const name of players.slice(1)) expect((await call("POST", `/api/tournaments/${id}/join`, name)).statusCode).toBe(200);
  return id;
}
const start = (id: string) => call("POST", `/api/tournaments/${id}/start`, "alice");
const pairings = (id: string) =>
  getDb().prepare(`SELECT round_number AS round, white_id AS white, black_id AS black, game_id AS game FROM tournament_pairings WHERE tournament_id = ?`)
    .all(id) as { round: number; white: number; black: number; game: string | null }[];
const startedGames = (id: string) => pairings(id).filter((p) => p.game && getDb().prepare(`SELECT status FROM games WHERE id = ?`).pluck().get(p.game) === "started");

async function resignAll(id: string, loser: (white: string, black: string) => string) {
  for (const p of startedGames(id)) {
    const res = await call("POST", `/api/games/${p.game}/resign`, loser(nameOf(p.white), nameOf(p.black)));
    expect(res.statusCode, res.body).toBe(200);
  }
}

beforeEach(async () => {
  openDb(":memory:");
  app = await buildApp();
  for (const name of NAMES) sids[name] = await registerUser(app, name);
});
afterEach(async () => {
  await app.close();
  closeDb();
});

describe("Simul2 tournaments", () => {
  it.each([["live", {}], ["correspondence", { mode: "correspondence", daysPerMove: 3, initialMs: undefined, incrementMs: undefined }]])(
    "starts every game at once in a single round (%s)",
    async (_label, extra) => {
      const id = await simul2(NAMES, extra);
      expect((await start(id)).statusCode).toBe(200);

      const rows = pairings(id);
      expect(rows).toHaveLength(6); // 4 players: everyone meets everyone once
      expect(rows.every((r) => r.round === 1 && r.game !== null)).toBe(true);
      expect(startedGames(id)).toHaveLength(6);

      const { tournament } = await detail(id);
      expect(tournament).toMatchObject({ status: "running", rounds: 1, currentRound: 1, format: "simul2" });

      for (const name of NAMES) {
        const mine = rows.filter((r) => r.white === uid(name) || r.black === uid(name));
        expect(mine, name).toHaveLength(3);
        const asWhite = mine.filter((r) => r.white === uid(name)).length;
        expect(Math.abs(asWhite - (3 - asWhite)), `${name} colours`).toBeLessThanOrEqual(1);
      }
    },
  );

  it("finishes once every game is done and ranks by points, then performance rating", async () => {
    const id = await simul2(NAMES, { rated: false });
    await start(id);
    // The better-named player always wins: alice > bob > carol > dave.
    const order = NAMES;
    await resignAll(id, (w, b) => (order.indexOf(w) < order.indexOf(b) ? b : w));

    const body = await detail(id);
    expect(body.tournament.status).toBe("completed");
    expect(body.standings.map((r: { username: string }) => r.username)).toEqual(NAMES);
    expect(body.standings.map((r: { points: number }) => r.points)).toEqual([3, 2, 1, 0]);
    const perf = body.standings.map((r: { performance: number }) => r.performance);
    expect(perf).toEqual([...perf].sort((a, b) => b - a));
    expect(perf.every((p: unknown) => typeof p === "number")).toBe(true);
  });

  it("does not complete while a single game is still being played", async () => {
    const id = await simul2(NAMES);
    await start(id);
    const [last, ...rest] = startedGames(id);
    for (const p of rest) await call("POST", `/api/games/${p.game}/resign`, nameOf(p.black));
    expect((await detail(id)).tournament.status).toBe("running");
    await call("POST", `/api/games/${last!.game}/resign`, nameOf(last!.black));
    expect((await detail(id)).tournament.status).toBe("completed");
  });

  it("snapshots each player's rating at the start for the tiebreak", async () => {
    getDb().prepare(`INSERT INTO ratings (user_id, variant, rating, rd, volatility, games, last_game_at) VALUES (?, 'standard', 1800, 80, 0.06, 20, 1)`).run(uid("dave"));
    const id = await simul2(NAMES, { rated: true });
    await start(id);
    const snapshot = () => getDb().prepare(`SELECT u.username, p.start_rating AS rating FROM tournament_participants p JOIN users u ON u.id = p.user_id WHERE p.tournament_id = ? ORDER BY p.seed`).all(id);
    expect(snapshot()).toEqual([
      { username: "dave", rating: 1800 }, { username: "alice", rating: 1500 }, { username: "bob", rating: 1500 }, { username: "carol", rating: 1500 },
    ]);
    await resignAll(id, (w) => w); // white resigns everywhere, so ratings move
    expect(snapshot()).toEqual([
      { username: "dave", rating: 1800 }, { username: "alice", rating: 1500 }, { username: "bob", rating: 1500 }, { username: "carol", rating: 1500 },
    ]);
  });

  it("allows at most 12 players", async () => {
    const tooMany = await call("POST", "/api/tournaments", "alice", {
      name: "Too big", format: "simul2", maxPlayers: 13, mode: "live", initialMs: 300_000, incrementMs: 0,
    });
    expect(tooMany.statusCode).toBe(400);
  });

  it("needs at least two players to start", async () => {
    const id = await simul2(["alice"]);
    expect((await start(id)).statusCode).toBeGreaterThanOrEqual(400);
  });
});
