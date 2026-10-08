import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { closeDb, getDb, openDb } from "../db/connection.js";
import { claimTimeoutAndPersist } from "../db/repositories/games.js";
import { registerUser } from "../testing/helpers.js";
import { repairStalledTournaments, startScheduledTournaments } from "./service.js";

let app: FastifyInstance;
const sids: Record<string, string> = {};
const NAMES = ["alice", "bob", "carol", "dave"];

const uid = (name: string) => (getDb().prepare(`SELECT id FROM users WHERE username = ?`).get(name) as { id: number }).id;
const nameOf = (id: number) => (getDb().prepare(`SELECT username FROM users WHERE id = ?`).get(id) as { username: string }).username;
const post = (url: string, user: string, payload?: unknown) =>
  app.inject({ method: "POST", url, cookies: { sessionId: sids[user]! }, payload: payload as object });

async function runningTournament(players: string[], extra: Record<string, unknown> = {}): Promise<string> {
  const created = await post("/api/tournaments", players[0]!, {
    name: "Test cup", mode: "live", initialMs: 300_000, incrementMs: 0, maxPlayers: 8, ...extra,
  });
  expect(created.statusCode, created.body).toBe(200);
  const id = created.json().tournamentId as string;
  for (const name of players.slice(1)) expect((await post(`/api/tournaments/${id}/join`, name)).statusCode).toBe(200);
  const started = await post(`/api/tournaments/${id}/start`, players[0]!);
  expect(started.statusCode, started.body).toBe(200);
  return id;
}

interface Pairing { round: number; board: number; white: number; black: number; game: string | null; forfeit: number | null; voided: number }
const pairings = (id: string) => getDb().prepare(`
  SELECT round_number AS round, board_number AS board, white_id AS white, black_id AS black,
         game_id AS game, forfeit_by AS forfeit, voided FROM tournament_pairings
  WHERE tournament_id = ? ORDER BY round_number, board_number
`).all(id) as Pairing[];
const isPaused = (id: string, name: string) =>
  (getDb().prepare(`SELECT paused FROM tournament_participants WHERE tournament_id = ? AND user_id = ?`)
    .get(id, uid(name)) as { paused: number }).paused === 1;
const tournamentRow = (id: string) =>
  getDb().prepare(`SELECT status, current_round FROM tournaments WHERE id = ?`).get(id) as { status: string; current_round: number };
const startedGames = (id: string) => getDb().prepare(`
  SELECT g.id FROM tournament_pairings p JOIN games g ON g.id = p.game_id WHERE p.tournament_id = ? AND g.status = 'started'
`).all(id) as { id: string }[];
const detail = async (id: string, user = "alice") =>
  (await app.inject({ method: "GET", url: `/api/tournaments/${id}`, cookies: { sessionId: sids[user]! } })).json();
// The first-move window has long expired by `Date.now() + 60s`.
const timeOut = (gameId: string) => claimTimeoutAndPersist(gameId, Date.now() + 60_000);
const resign = (gameId: string, loser: number) => post(`/api/games/${gameId}/resign`, nameOf(loser));

beforeEach(async () => {
  openDb(":memory:");
  app = await buildApp();
  for (const name of NAMES) sids[name] = await registerUser(app, name);
});

afterEach(async () => {
  await app.close();
  closeDb();
});

describe("aborted tournament games", () => {
  it("a first-move timeout forfeits to the opponent and pauses the player who never moved", async () => {
    const id = await runningTournament(NAMES);
    const [first, second] = pairings(id).filter((p) => p.round === 1);
    expect(timeOut(first!.game!).ok).toBe(true); // white (to move) never moved

    expect(pairings(id).find((p) => p.game === first!.game)!.forfeit).toBe(first!.white);
    expect(isPaused(id, nameOf(first!.white))).toBe(true);
    expect(isPaused(id, nameOf(first!.black))).toBe(false);

    const standings = (await detail(id)).standings as { id: number; points: number; gamesPlayed: number }[];
    expect(standings.find((s) => s.id === first!.black)).toMatchObject({ points: 1, gamesPlayed: 1 });
    expect(standings.find((s) => s.id === first!.white)).toMatchObject({ points: 0, gamesPlayed: 1 });

    expect((await resign(second!.game!, second!.white)).statusCode).toBe(200);
    expect(tournamentRow(id).current_round).toBe(2);
  });

  it("manual abort is charged to the player who pressed it, not to the side to move", async () => {
    const id = await runningTournament(NAMES);
    const first = pairings(id).find((p) => p.round === 1)!;
    // Black presses abort although white is the one who has not moved.
    expect((await post(`/api/games/${first.game}/abort`, nameOf(first.black))).statusCode).toBe(200);
    expect(pairings(id).find((p) => p.game === first.game)!.forfeit).toBe(first.black);
    expect(isPaused(id, nameOf(first.black))).toBe(true);
    expect(isPaused(id, nameOf(first.white))).toBe(false);
  });

  it("settles a paused player's later pairings as forfeits and still creates the others", async () => {
    const id = await runningTournament(NAMES);
    const [first, second] = pairings(id).filter((p) => p.round === 1);
    const quitter = first!.white;
    timeOut(first!.game!);
    await resign(second!.game!, second!.white);

    const round2 = pairings(id).filter((p) => p.round === 2);
    const quitterGame = round2.find((p) => p.white === quitter || p.black === quitter)!;
    expect(quitterGame.game).toBeNull();
    expect(quitterGame.forfeit).toBe(quitter);
    const other = round2.find((p) => p !== quitterGame)!;
    expect(other.game).not.toBeNull();
    expect(other.forfeit).toBeNull();
    expect((await detail(id)).skipped).toEqual([expect.objectContaining({ round: 2, voided: false, result: expect.any(String) })]);
  });

  it("lets a paused player resume, and pairs them from the next round", async () => {
    const id = await runningTournament(NAMES);
    const [first, second] = pairings(id).filter((p) => p.round === 1);
    const quitter = nameOf(first!.white);
    timeOut(first!.game!);

    expect((await post(`/api/tournaments/${id}/resume`, nameOf(first!.black))).statusCode).toBe(409); // not paused
    const resumed = await post(`/api/tournaments/${id}/resume`, quitter);
    expect(resumed.statusCode, resumed.body).toBe(200);
    expect(isPaused(id, quitter)).toBe(false);
    expect((await detail(id, quitter)).tournament.paused).toBe(false);

    await resign(second!.game!, second!.white);
    const round2 = pairings(id).filter((p) => p.round === 2);
    expect(round2.every((p) => p.game !== null && p.forfeit === null)).toBe(true);
  });

  it("skips rounds where nothing can be played, so the tournament never stalls", async () => {
    const id = await runningTournament(["alice", "bob", "carol"]);
    const first = pairings(id).find((p) => p.round === 1 && p.game)!;
    timeOut(first.game!); // white forfeits and is paused

    // Rounds 2 and 3 each have one pairing; the one involving the paused player is settled at once.
    const state = tournamentRow(id);
    const live = startedGames(id);
    expect(state.status).toBe("running");
    expect(live).toHaveLength(1);
    const remaining = pairings(id).find((p) => p.game === live[0]!.id)!;
    expect([remaining.white, remaining.black]).not.toContain(first.white);
    expect(state.current_round).toBe(remaining.round);

    await resign(live[0]!.id, remaining.white);
    expect(tournamentRow(id).status).toBe("completed");
  });

  it("completes a two-player tournament with a forfeit win", async () => {
    const id = await runningTournament(["alice", "bob"]);
    const game = pairings(id)[0]!;
    timeOut(game.game!);
    expect(tournamentRow(id).status).toBe("completed");
    const standings = (await detail(id)).standings as { id: number; points: number }[];
    expect(standings[0]).toMatchObject({ id: game.black, points: 1 });
  });

  it("charges the forfeit but does not pause in correspondence tournaments", async () => {
    const id = await runningTournament(["alice", "bob", "carol"], { mode: "correspondence", daysPerMove: 3, initialMs: undefined, incrementMs: undefined });
    const first = pairings(id).find((p) => p.game)!;
    expect((await post(`/api/games/${first.game}/abort`, nameOf(first.white))).statusCode).toBe(200);
    expect(pairings(id).find((p) => p.game === first.game)!.forfeit).toBe(first.white);
    expect(isPaused(id, nameOf(first.white))).toBe(false);
    expect(tournamentRow(id).status).toBe("running"); // the other games are still going
  });

  it("repairs a tournament whose round change was lost", async () => {
    const id = await runningTournament(["alice", "bob", "carol"]);
    // Finish the only game behind the tournament's back, as if advancing the round had failed.
    getDb().prepare(`
      UPDATE games SET status = 'finished', result = '1-0', termination = 'resignation', ended_at = ?
      WHERE id IN (SELECT game_id FROM tournament_pairings WHERE tournament_id = ?)
    `).run(Date.now(), id);
    expect(startedGames(id)).toHaveLength(0);

    expect(repairStalledTournaments()).toEqual([id]);
    expect(tournamentRow(id).current_round).toBe(2);
    expect(startedGames(id)).toHaveLength(1);
    expect(repairStalledTournaments()).toEqual([]);
  });
});

describe("tournament rules", () => {
  it("limits how many active tournaments one user can have", async () => {
    const make = () => post("/api/tournaments", "alice", { name: "Cup", mode: "live", initialMs: 300_000, incrementMs: 0, maxPlayers: 4 });
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await make()).json().tournamentId);
    expect((await make()).statusCode).toBe(409);
    expect((await post(`/api/tournaments/${ids[0]}/cancel`, "alice")).statusCode).toBe(200);
    expect((await make()).statusCode).toBe(200);
  });

  it("enforces capacity, withdrawal, and organizer-only cancel", async () => {
    const created = await post("/api/tournaments", "alice", { name: "Tiny", mode: "live", initialMs: 300_000, incrementMs: 0, maxPlayers: 2 });
    const id = created.json().tournamentId as string;
    expect((await post(`/api/tournaments/${id}/join`, "bob")).statusCode).toBe(200);
    expect((await post(`/api/tournaments/${id}/join`, "carol")).statusCode).toBe(409); // full

    const withdraw = await app.inject({ method: "DELETE", url: `/api/tournaments/${id}/join`, cookies: { sessionId: sids.bob! } });
    expect(withdraw.statusCode).toBe(200);
    expect((await post(`/api/tournaments/${id}/join`, "carol")).statusCode).toBe(200); // the seat is free again

    expect((await post(`/api/tournaments/${id}/cancel`, "bob")).statusCode).toBe(403);
    expect((await post(`/api/tournaments/${id}/cancel`, "alice")).statusCode).toBe(200);
    expect(tournamentRow(id).status).toBe("cancelled");
    expect((await post(`/api/tournaments/${id}/join`, "dave")).statusCode).toBe(409);
  });

  it("rejects guests", async () => {
    const link = await post("/api/challenges", "alice", { mode: "live", initialMs: 300_000, incrementMs: 0, link: true, colorPref: "white" });
    const guest = await app.inject({ method: "POST", url: "/api/guest", payload: { challengeId: link.json().challengeId } });
    const guestSid = guest.cookies.find((c) => c.name === "sessionId")!.value;
    const guestPost = (url: string, payload?: object) => app.inject({ method: "POST", url, cookies: { sessionId: guestSid }, payload });

    expect((await guestPost("/api/tournaments", { name: "Guest cup", mode: "live", initialMs: 300_000, incrementMs: 0, maxPlayers: 4 })).statusCode).toBe(403);
    const id = (await post("/api/tournaments", "alice", { name: "Cup", mode: "live", initialMs: 300_000, incrementMs: 0, maxPlayers: 4 })).json().tournamentId;
    expect((await guestPost(`/api/tournaments/${id}/join`)).statusCode).toBe(403);
  });

  it("breaks ties on wins, then alphabetically", async () => {
    // alice beats bob, bob beats carol, carol beats alice: everyone has 1 point and 1 win.
    const id = await runningTournament(["alice", "bob", "carol"], { mode: "correspondence", daysPerMove: 3, initialMs: undefined, incrementMs: undefined });
    const beats = new Map([["alice", "bob"], ["bob", "carol"], ["carol", "alice"]]);
    for (const p of pairings(id)) {
      const winner = [nameOf(p.white), nameOf(p.black)].find((name) => beats.get(name) === [nameOf(p.white), nameOf(p.black)].find((n) => n !== name))!;
      const loser = winner === nameOf(p.white) ? p.black : p.white;
      expect((await resign(p.game!, loser)).statusCode).toBe(200);
    }
    const standings = (await detail(id)).standings as { username: string; points: number; wins: number }[];
    expect(standings.map((s) => [s.username, s.points, s.wins])).toEqual([["alice", 1, 1], ["bob", 1, 1], ["carol", 1, 1]]);
  });

  it("does not let a tournament that cannot start block the ones behind it", async () => {
    const startsAt = Date.now() + 60_000;
    const lonely = (await post("/api/tournaments", "alice", { name: "Lonely", mode: "live", initialMs: 300_000, incrementMs: 0, maxPlayers: 4, startsAt })).json().tournamentId as string;
    const ready = (await post("/api/tournaments", "bob", { name: "Ready", mode: "live", initialMs: 300_000, incrementMs: 0, maxPlayers: 4, startsAt: startsAt + 1 })).json().tournamentId as string;
    await post(`/api/tournaments/${ready}/join`, "carol");

    const result = startScheduledTournaments(startsAt + 1);
    expect(result).toEqual({ started: [ready], cancelled: [lonely] });
    expect(tournamentRow(lonely).status).toBe("cancelled");
    expect(tournamentRow(ready).status).toBe("running");
  });

  it("rejects a start time in the past", async () => {
    const res = await post("/api/tournaments", "alice", { name: "Late", mode: "live", initialMs: 300_000, incrementMs: 0, maxPlayers: 4, startsAt: Date.now() - 1000 });
    expect(res.statusCode).toBe(400);
  });
});