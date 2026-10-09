import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { closeDb, getDb, openDb } from "../db/connection.js";
import { claimTimeoutAndPersist } from "../db/repositories/games.js";
import { registerUser } from "../testing/helpers.js";
import { finishDueArenas, runArenaPairing } from "./arena.js";
import { repairStalledTournaments } from "./service.js";

let app: FastifyInstance;
const sids: Record<string, string> = {};
const NAMES = ["alice", "bob", "carol", "dave", "erin", "frank"];

const uid = (name: string) => (getDb().prepare(`SELECT id FROM users WHERE username = ?`).get(name) as { id: number }).id;
const nameOf = (id: number) => (getDb().prepare(`SELECT username FROM users WHERE id = ?`).get(id) as { username: string }).username;
const post = (url: string, user: string, payload?: unknown) =>
  app.inject({ method: "POST", url, cookies: { sessionId: sids[user]! }, payload: payload as object });
const detail = async (id: string, user = "alice") =>
  (await app.inject({ method: "GET", url: `/api/tournaments/${id}`, cookies: { sessionId: sids[user]! } })).json();

const LIVE = { mode: "live", initialMs: 300_000, incrementMs: 0 };
const CORR = { mode: "correspondence", daysPerMove: 3 };

async function create(format: string, players: string[], extra: Record<string, unknown> = {}, start = true): Promise<string> {
  const clock = extra.mode === "correspondence" ? {} : LIVE;
  const created = await post("/api/tournaments", players[0]!, { name: `${format} cup`, format, maxPlayers: 16, ...clock, ...extra });
  expect(created.statusCode, created.body).toBe(200);
  const id = created.json().tournamentId as string;
  for (const name of players.slice(1)) expect((await post(`/api/tournaments/${id}/join`, name)).statusCode).toBe(200);
  if (start) {
    const started = await post(`/api/tournaments/${id}/start`, players[0]!);
    expect(started.statusCode, started.body).toBe(200);
  }
  return id;
}

interface Row { round: number; board: number; match: number | null; leg: number; white: number; black: number | null; game: string | null; bye: number; forfeit: number | null }
const rows = (id: string) => getDb().prepare(`
  SELECT round_number AS round, board_number AS board, match_number AS match, leg, white_id AS white, black_id AS black,
         game_id AS game, is_bye AS bye, forfeit_by AS forfeit
  FROM tournament_pairings WHERE tournament_id = ? ORDER BY round_number, board_number
`).all(id) as Row[];
const running = (id: string) => rows(id).filter((r) => r.game && (getDb().prepare(`SELECT status FROM games WHERE id = ?`).get(r.game) as { status: string }).status === "started");
const tournament = (id: string) =>
  getDb().prepare(`SELECT status, current_round AS currentRound, rounds, ends_at AS endsAt FROM tournaments WHERE id = ?`).get(id) as
    { status: string; currentRound: number; rounds: number | null; endsAt: number | null };

type Outcome = "white" | "black" | "draw";
async function finish(gameId: string, outcome: Outcome) {
  const g = getDb().prepare(`SELECT white_id AS w, black_id AS b FROM games WHERE id = ?`).get(gameId) as { w: number; b: number };
  if (outcome === "draw") {
    expect((await post(`/api/games/${gameId}/draw/offer`, nameOf(g.w))).statusCode).toBe(200);
    expect((await post(`/api/games/${gameId}/draw/accept`, nameOf(g.b))).statusCode).toBe(200);
  } else {
    const loser = outcome === "white" ? g.b : g.w;
    expect((await post(`/api/games/${gameId}/resign`, nameOf(loser))).statusCode).toBe(200);
  }
}
async function finishAll(id: string, outcome: Outcome | ((r: Row) => Outcome) = "white") {
  for (const r of running(id)) await finish(r.game!, typeof outcome === "function" ? outcome(r) : outcome);
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

describe("creating tournaments", () => {
  const body = { name: "Format cup", ...LIVE, maxPlayers: 8 };
  const create400 = async (extra: Record<string, unknown>) => (await post("/api/tournaments", "alice", { ...body, ...extra })).statusCode;

  it("validates format-specific settings", async () => {
    expect(await create400({ format: "arena" })).toBe(400); // needs a duration
    expect(await create400({ format: "arena", ...CORR, mode: "correspondence", initialMs: undefined, durationMinutes: 30 })).toBe(400);
    expect(await create400({ format: "swiss", durationMinutes: 30 })).toBe(400);
    expect(await create400({ format: "round_robin", rounds: 3 })).toBe(400);
    expect(await create400({ format: "round_robin", maxPlayers: 17 })).toBe(400);
    expect(await create400({ format: "swiss", maxPlayers: 4, rounds: 4 })).toBe(400); // more than n - 1
    expect(await create400({ format: "nonsense" })).toBe(400);
    expect(await create400({ format: "arena", durationMinutes: 30 })).toBe(200);
    expect(await create400({ format: "swiss", maxPlayers: 40, rounds: 5 })).toBe(200);
  });

  it("computes an arena's end time when it starts", async () => {
    const id = await create("arena", ["alice", "bob"], { durationMinutes: 30 }, false);
    expect(tournament(id).endsAt).toBeNull();
    const before = Date.now();
    await post(`/api/tournaments/${id}/start`, "alice");
    expect(tournament(id).endsAt).toBeGreaterThanOrEqual(before + 30 * 60_000);
  });
});

describe("swiss", () => {
  it("pairs a new round each time the last one finishes, never repeating a pairing", async () => {
    const id = await create("swiss", ["alice", "bob", "carol", "dave"]);
    expect(tournament(id)).toMatchObject({ rounds: 2, currentRound: 1, status: "running" });
    expect(running(id)).toHaveLength(2);
    expect(rows(id).every((r) => r.round === 1)).toBe(true); // round 2 does not exist yet

    await finishAll(id);
    expect(tournament(id)).toMatchObject({ currentRound: 2, status: "running" });
    await finishAll(id);
    expect(tournament(id).status).toBe("completed");

    const pairs = rows(id).map((r) => [r.white, r.black].sort().join("-"));
    expect(new Set(pairs).size).toBe(pairs.length);
    const standings = (await detail(id)).standings as { points: number }[];
    expect(standings.reduce((sum, row) => sum + row.points, 0)).toBe(4);
  });

  it("gives a bye to a different player each round, and scores it as a win", async () => {
    const id = await create("swiss", ["alice", "bob", "carol"]);
    await finishAll(id);
    await finishAll(id);
    expect(tournament(id).status).toBe("completed");
    const byes = rows(id).filter((r) => r.bye).map((r) => r.white);
    expect(byes).toHaveLength(2);
    expect(new Set(byes).size).toBe(2);
    const data = await detail(id);
    expect(data.byes).toHaveLength(2);
    expect(data.standings.reduce((sum: number, row: { points: number }) => sum + row.points, 0)).toBe(4); // 2 games + 2 byes
  });

  it("works for correspondence games too, one round at a time", async () => {
    const id = await create("swiss", ["alice", "bob", "carol", "dave"], CORR);
    expect(running(id)).toHaveLength(2);
    expect(rows(id)).toHaveLength(2);
    await finishAll(id);
    expect(rows(id).filter((r) => r.round === 2)).toHaveLength(2);
    expect(tournament(id).status).toBe("running");
  });

  it("leaves paused players out of later rounds", async () => {
    const id = await create("swiss", ["alice", "bob", "carol", "dave", "erin"], { rounds: 3 });
    expect((await post(`/api/tournaments/${id}/pause`, "erin")).statusCode).toBe(200);
    await finishAll(id);
    const round2 = rows(id).filter((r) => r.round === 2);
    expect(round2.flatMap((r) => [r.white, r.black, r.bye ? r.white : null])).not.toContain(uid("erin"));
    expect((await post(`/api/tournaments/${id}/resume`, "erin")).statusCode).toBe(200);
  });

  it("restarts pairing for a round that never got created", async () => {
    const id = await create("swiss", ["alice", "bob", "carol", "dave"]);
    const games = running(id);
    // Finish round 1 behind the scheduler's back, so nothing creates round 2.
    getDb().prepare(`UPDATE games SET status = 'finished', result = '1-0', termination = 'resignation', ended_at = 1 WHERE id IN (?, ?)`)
      .run(games[0]!.game, games[1]!.game);
    expect(running(id)).toHaveLength(0);
    expect(repairStalledTournaments()).toEqual([id]);
    expect(rows(id).filter((r) => r.round === 2).length).toBeGreaterThan(0);
    expect(repairStalledTournaments()).toEqual([]); // nothing left to repair
  });
});

describe("knockout", () => {
  it("builds a seeded bracket with byes and plays it to a champion", async () => {
    const id = await create("knockout", ["alice", "bob", "carol", "dave", "erin"]);
    expect(tournament(id).rounds).toBe(3);
    const first = rows(id);
    expect(first.filter((r) => r.bye).map((r) => r.white).sort()).toEqual([uid("alice"), uid("bob"), uid("carol")].sort());
    expect(running(id)).toHaveLength(1); // dave (4) v erin (5)
    expect(running(id)[0]).toMatchObject({ white: uid("dave"), black: uid("erin") });

    await finishAll(id, "white"); // dave advances
    expect(tournament(id).currentRound).toBe(2);
    const semis = running(id);
    expect(semis).toHaveLength(2);
    expect(semis.map((r) => [r.white, r.black])).toEqual([[uid("alice"), uid("dave")], [uid("bob"), uid("carol")]]);

    await finishAll(id, "white"); // alice and bob advance
    await finishAll(id, "black"); // final: the lower seed (black) wins
    expect(tournament(id).status).toBe("completed");

    const data = await detail(id);
    expect(data.standings[0].username).toBe("bob");
    expect(data.bracket).toHaveLength(3);
    expect(data.bracket[2].matches[0]).toMatchObject({ winnerId: uid("bob") });
  });

  it("replays a drawn game with the colours swapped, then hands a third draw to the higher seed", async () => {
    const id = await create("knockout", ["alice", "bob"]);
    const [leg1] = running(id);
    await finish(leg1!.game!, "draw");
    const [leg2] = running(id);
    expect(leg2).toMatchObject({ leg: 2, white: leg1!.black, black: leg1!.white, round: 1, match: 1 });
    expect(tournament(id).status).toBe("running");

    await finish(leg2!.game!, "draw");
    const [leg3] = running(id);
    expect(leg3!.leg).toBe(3);
    await finish(leg3!.game!, "draw");

    expect(tournament(id).status).toBe("completed");
    const match = (await detail(id)).bracket[0].matches[0];
    expect(match).toMatchObject({ winnerId: uid("alice"), bySeed: true });
    expect(match.legs).toHaveLength(3);
  });

  it("gives the match to the opponent when a player never shows up", async () => {
    const id = await create("knockout", ["alice", "bob"]);
    const [leg] = running(id);
    claimTimeoutAndPersist(leg!.game!, Date.now() + 60_000); // white never moved: aborted, white forfeits
    expect(tournament(id).status).toBe("completed");
    expect((await detail(id)).standings[0].username).toBe("bob");
  });

  it("advances correspondence knockouts round by round", async () => {
    const id = await create("knockout", ["alice", "bob", "carol", "dave"], CORR);
    expect(running(id)).toHaveLength(2);
    await finishAll(id);
    expect(tournament(id).currentRound).toBe(2);
    expect(running(id)).toHaveLength(1);
  });
});

describe("arena", () => {
  const everyone = () => true;

  async function arena(players: string[], extra: Record<string, unknown> = {}) {
    return create("arena", players, { durationMinutes: 30, ...extra });
  }

  it("starts without pairing and pairs only players who are online", async () => {
    const id = await arena(["alice", "bob", "carol"]);
    expect(rows(id)).toHaveLength(0);
    expect(runArenaPairing(Date.now(), (user) => user !== uid("carol"))).toEqual([id]);
    expect(running(id)).toHaveLength(1);
    expect(new Set([running(id)[0]!.white, running(id)[0]!.black])).toEqual(new Set([uid("alice"), uid("bob")]));
    expect(runArenaPairing(Date.now(), (user) => user !== uid("carol"))).toEqual([]); // nobody else is free
  });

  it("keeps pairing as games end, without an immediate rematch when someone else is free", async () => {
    const id = await arena(["alice", "bob", "carol"]);
    runArenaPairing(Date.now(), everyone);
    const [first] = running(id);
    await finish(first!.game!, "white");

    expect(runArenaPairing(Date.now(), everyone)).toEqual([id]);
    const [second] = running(id);
    const pair = (r: Row) => [r.white, r.black].sort().join("-");
    expect(pair(second!)).not.toBe(pair(first!));
    expect(rows(id).every((r) => r.round === 1)).toBe(true);
    expect(rows(id).map((r) => r.board)).toEqual([1, 2]);
  });

  it("scores 2 per win and doubles after two wins in a row", async () => {
    const id = await arena(["alice", "bob"]);
    for (let i = 0; i < 4; i++) {
      runArenaPairing(Date.now(), everyone);
      await finishAll(id, (r) => (r.white === uid("alice") ? "white" : "black")); // alice always wins
    }
    const alice = (await detail(id)).standings.find((r: { username: string }) => r.username === "alice");
    expect(alice).toMatchObject({ points: 2 + 2 + 4 + 4, wins: 4, onFire: true });
  });

  it("lets players join late, pause and resume, but not once the arena has ended", async () => {
    const id = await arena(["alice", "bob"]);
    expect((await post(`/api/tournaments/${id}/join`, "carol")).statusCode).toBe(200);
    expect((await detail(id, "carol")).participants.find((p: { username: string }) => p.username === "carol").seed).toBe(3);

    expect((await post(`/api/tournaments/${id}/pause`, "carol")).statusCode).toBe(200);
    runArenaPairing(Date.now(), everyone);
    expect(running(id).flatMap((r) => [r.white, r.black])).not.toContain(uid("carol"));
    expect((await post(`/api/tournaments/${id}/resume`, "carol")).statusCode).toBe(200);

    getDb().prepare(`UPDATE tournaments SET ends_at = ? WHERE id = ?`).run(Date.now() - 1, id);
    expect((await post(`/api/tournaments/${id}/join`, "dave")).statusCode).toBe(409);
  });

  it("stops pairing near the end and completes once the last game is over", async () => {
    const id = await arena(["alice", "bob"]);
    runArenaPairing(Date.now(), everyone);
    const [game] = running(id);

    // Inside the last clock-length of the arena: no new games, and the arena stays open for the one running.
    getDb().prepare(`UPDATE tournaments SET ends_at = ? WHERE id = ?`).run(Date.now() + 10_000, id);
    expect(runArenaPairing(Date.now(), everyone)).toEqual([]);
    expect(finishDueArenas(Date.now() + 20_000)).toEqual([]); // a game is still running

    getDb().prepare(`UPDATE tournaments SET ends_at = ? WHERE id = ?`).run(Date.now() - 1, id);
    await finish(game!.game!, "white");
    expect(tournament(id).status).toBe("completed");
  });

  it("completes an arena with no games left when its time is up", async () => {
    const id = await arena(["alice", "bob"]);
    expect(finishDueArenas(Date.now())).toEqual([]);
    expect(finishDueArenas(Date.now() + 31 * 60_000)).toEqual([id]);
    expect(tournament(id).status).toBe("completed");
  });

  it("pauses a player who never makes their first move, so they stop being paired", async () => {
    const id = await arena(["alice", "bob"]);
    runArenaPairing(Date.now(), everyone);
    const [game] = running(id);
    claimTimeoutAndPersist(game!.game!, Date.now() + 60_000);
    const paused = (name: string) => (getDb().prepare(`SELECT paused FROM tournament_participants WHERE tournament_id = ? AND user_id = ?`)
      .get(id, uid(name)) as { paused: number }).paused;
    expect(paused(nameOf(game!.white))).toBe(1);
    expect(runArenaPairing(Date.now(), everyone)).toEqual([]);
  });

  it("limits pause to arena and swiss tournaments", async () => {
    const id = await create("round_robin", ["alice", "bob", "carol"]);
    expect((await post(`/api/tournaments/${id}/pause`, "bob")).statusCode).toBe(409);
  });
});

describe("tournament detail", () => {
  it("names players in forfeited-and-skipped pairings", async () => {
    const id = await create("round_robin", ["alice", "bob", "carol", "dave"]);
    const [first] = running(id);
    claimTimeoutAndPersist(first!.game!, Date.now() + 60_000); // white is paused after never moving
    await finishAll(id);
    const data = await detail(id);
    expect(data.skipped.length).toBeGreaterThan(0);
    for (const skipped of data.skipped) {
      expect(typeof skipped.whiteName).toBe("string");
      expect(typeof skipped.blackName).toBe("string");
    }
    expect(data.games.some((g: { forfeit: boolean }) => g.forfeit)).toBe(true);
  });

  it("scores repeated pairings separately (standings no longer match games by colour pair)", async () => {
    const id = await create("arena", ["alice", "bob"], { durationMinutes: 30 });
    for (let i = 0; i < 2; i++) {
      runArenaPairing(Date.now(), () => true);
      await finishAll(id, "white");
    }
    const data = await detail(id);
    expect(data.standings.reduce((sum: number, row: { gamesPlayed: number }) => sum + row.gamesPlayed, 0)).toBe(4);
  });
});
