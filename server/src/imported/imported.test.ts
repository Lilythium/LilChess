import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { closeDb, getDb, openDb } from "../db/connection.js";
import { registerUser, startGame } from "../testing/helpers.js";
import { MAX_IMPORTED_PER_USER, saveImportedGames } from "./queries.js";
import { parsePgnGames } from "@lilchess/shared";

const MATE = (white: string, black: string, extra = "") => `[Event "Test"]
[White "${white}"]
[Black "${black}"]
[Result "1-0"]
${extra}
1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0`;

describe("imported games", () => {
  let app: FastifyInstance;
  let alice: string;
  let bob: string;

  const importPgn = (sid: string | undefined, pgn: string) =>
    app.inject({ method: "POST", url: "/api/imported", cookies: sid ? { sessionId: sid } : {}, payload: { pgn } });
  const list = (sid: string) => app.inject({ method: "GET", url: "/api/imported", cookies: { sessionId: sid } });
  const count = (sql: string) => getDb().prepare(sql).pluck().get() as number;

  beforeEach(async () => {
    openDb(":memory:");
    app = await buildApp();
    alice = await registerUser(app, "alice");
    bob = await registerUser(app, "bob");
  });
  afterEach(async () => {
    await app.close();
    closeDb();
  });

  it("imports someone else's game without putting the importer in it", async () => {
    const res = await importPgn(alice, MATE("Carlsen, Magnus", "Nakamura, Hikaru"));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, duplicates: 0, failures: [] });
    expect(res.json().imported).toHaveLength(1);

    const body = (await list(alice)).json();
    expect(body.total).toBe(1);
    expect(body.games[0]).toMatchObject({ white: "Carlsen, Magnus", black: "Nakamura, Hikaru", result: "1-0", plies: 7 });
  });

  it("keeps imports out of game history, head-to-head, accounts and the clock scheduler", async () => {
    const usersBefore = count(`SELECT COUNT(*) FROM users`);
    // A PGN naming a real user (bob) and made-up names.
    await importPgn(alice, MATE("bob", "magnus"));
    await importPgn(alice, `[White "carol"]\n[Black "dave"]\n[Result "*"]\n\n1. e4 e5 *`);

    expect(count(`SELECT COUNT(*) FROM users`)).toBe(usersBefore); // no placeholder accounts
    expect(count(`SELECT COUNT(*) FROM games`)).toBe(0); // nothing that could time out or count in H2H

    const mine = (await app.inject({ method: "GET", url: "/api/games/my-games", cookies: { sessionId: alice } })).json();
    expect(mine.finished).toHaveLength(0);
    const bobsGames = (await app.inject({ method: "GET", url: "/api/games/my-games", cookies: { sessionId: bob } })).json();
    expect(bobsGames.finished).toHaveLength(0);
    const profile = (await app.inject({ method: "GET", url: "/api/users/bob", cookies: { sessionId: alice } })).json();
    expect(profile.h2h).toEqual({ wins: 0, draws: 0, losses: 0 });
    expect(profile.games).toHaveLength(0);
  });

  it("does not let an import squat a username", async () => {
    await importPgn(alice, MATE("magnus", "hikaru"));
    const res = await app.inject({ method: "POST", url: "/api/register", payload: { username: "magnus", password: "hunter22!" } });
    expect(res.statusCode).toBe(200);
  });

  it("keeps both names when the importer did play", async () => {
    await importPgn(alice, MATE("alice", "bob"));
    const game = (await list(alice)).json().games[0];
    expect(game).toMatchObject({ white: "alice", black: "bob" });
  });

  it("accepts annotated games (!! and ??)", async () => {
    const res = await importPgn(alice, `[White "A"]\n[Black "B"]\n\n1. e4!! e5?? 2. Qh5!? Nc6 3. Bc4 Nf6?? 4. Qxf7# 1-0`);
    expect(res.statusCode).toBe(200);
    expect(res.json().imported).toHaveLength(1);
  });

  it("imports the good games of a file and reports the bad one", async () => {
    const pgn = `${MATE("a", "b")}\n\n[White "c"]\n[Black "d"]\n\n1. e4 e5 2. Qh6 Nc6 *\n\n${MATE("e", "f")}`;
    const res = await importPgn(alice, pgn);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.imported).toHaveLength(2);
    expect(body.failures).toHaveLength(1);
    expect(body.failures[0]).toMatchObject({ index: 2, label: "Game 2 (c vs d)" });
    expect((await list(alice)).json().total).toBe(2);
  });

  it("400s when nothing in the file can be imported", async () => {
    const res = await importPgn(alice, "1. e4 e5 2. Qh6 Nc6");
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Illegal or unreadable move "Qh6"/);
    const garbage = await importPgn(alice, "hello world");
    expect(garbage.statusCode).toBe(400);
    expect(garbage.json().error).toBe("No moves found.");
  });

  it("refuses unsupported variants rather than filing them as standard", async () => {
    const res = await importPgn(alice, `[Variant "Atomic"]\n[White "a"]\n[Black "b"]\n\n1. e4 e5 *`);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Unsupported variant "Atomic"/);
  });

  it("skips a game the user already imported", async () => {
    await importPgn(alice, MATE("a", "b"));
    const again = (await importPgn(alice, MATE("a", "b"))).json();
    expect(again).toMatchObject({ ok: true, imported: [], duplicates: 1 });
    expect((await list(alice)).json().total).toBe(1);
    // Someone else importing the same game gets their own copy.
    expect((await importPgn(bob, MATE("a", "b"))).json().imported).toHaveLength(1);
  });

  it("stores an unfinished game as unfinished", async () => {
    await importPgn(alice, `[White "a"]\n[Black "b"]\n\n1. e4 e5 *`);
    const game = (await list(alice)).json().games[0];
    expect(game.result).toBe("*");
    expect(game.fen).toContain("4p3/4P3"); // final position, not the start
    expect(game.lastMove).toBe("e7e5");
  });

  describe("access", () => {
    it("is private to the owner", async () => {
      const id = (await importPgn(alice, MATE("a", "b"))).json().imported[0] as string;
      expect((await list(bob)).json()).toMatchObject({ total: 0, games: [] });
      expect((await app.inject({ method: "GET", url: `/api/imported/${id}`, cookies: { sessionId: bob } })).statusCode).toBe(404);
      expect((await app.inject({ method: "DELETE", url: `/api/imported/${id}`, cookies: { sessionId: bob } })).statusCode).toBe(404);
      expect((await app.inject({ method: "GET", url: `/api/imported/${id}`, cookies: { sessionId: alice } })).statusCode).toBe(200);
    });

    it("needs a session, and guests can't import", async () => {
      expect((await importPgn(undefined, MATE("a", "b"))).statusCode).toBe(401);
      expect((await app.inject({ method: "GET", url: "/api/imported" })).statusCode).toBe(401);
      const link = await app.inject({
        method: "POST", url: "/api/challenges", cookies: { sessionId: alice },
        payload: { mode: "live", initialMs: 300_000, incrementMs: 0, link: true, colorPref: "white" },
      });
      const guest = await app.inject({ method: "POST", url: "/api/guest", payload: { challengeId: link.json().challengeId } });
      const sid = guest.cookies.find((c) => c.name === "sessionId")?.value;
      expect(sid).toBeTruthy();
      expect((await importPgn(sid, MATE("a", "b"))).statusCode).toBe(403);
    });

    it("validates ids and paging", async () => {
      expect((await app.inject({ method: "GET", url: "/api/imported/not-an-id!", cookies: { sessionId: alice } })).statusCode).toBe(400);
      expect((await app.inject({ method: "GET", url: "/api/imported?limit=0", cookies: { sessionId: alice } })).statusCode).toBe(400);
    });

    it("no longer has the old endpoint", async () => {
      const res = await app.inject({ method: "POST", url: "/api/games/import", cookies: { sessionId: alice }, payload: { pgn: MATE("a", "b") } });
      expect(res.statusCode).toBe(404);
    });
  });

  it("serves a game in the shape the analysis page loads, and deletes it", async () => {
    const id = (await importPgn(alice, MATE("a", "b", '[TimeControl "60+0"]\n[Termination "Normal"]'))).json().imported[0] as string;
    const res = await app.inject({ method: "GET", url: `/api/imported/${id}`, cookies: { sessionId: alice } });
    expect(res.json()).toMatchObject({
      ok: true, variant: "standard", status: "finished", result: "1-0", white: "a", black: "b",
      moves: ["e2e4", "e7e5", "d1h5", "b8c6", "f1c4", "g8f6", "h5f7"],
    });
    expect(res.json().initialFen).toContain("rnbqkbnr/pppppppp");

    expect((await app.inject({ method: "DELETE", url: `/api/imported/${id}`, cookies: { sessionId: alice } })).json()).toEqual({ ok: true });
    expect((await list(alice)).json().total).toBe(0);
    expect(count(`SELECT COUNT(*) FROM imported_moves`)).toBe(0); // the moves went with it
  });

  it("pages the list newest first", async () => {
    for (let i = 0; i < 3; i++) await importPgn(alice, MATE(`w${i}`, `b${i}`));
    const page = (await app.inject({ method: "GET", url: "/api/imported?limit=2&offset=1", cookies: { sessionId: alice } })).json();
    expect(page.total).toBe(3);
    expect(page.games.map((g: { white: string }) => g.white)).toEqual(["w1", "w0"]);
  });

  it("stops at the per-user cap and tells the user", async () => {
    const { games } = parsePgnGames(`${MATE("a", "b")}\n\n${MATE("c", "d")}\n\n${MATE("e", "f")}`);
    const aliceId = getDb().prepare(`SELECT id FROM users WHERE username = 'alice'`).pluck().get() as number;
    const out = saveImportedGames(aliceId, games, { maxPerUser: 2 });
    expect(out).toMatchObject({ duplicates: 0, overLimit: 1 });
    expect(out.imported).toHaveLength(2);
    expect(MAX_IMPORTED_PER_USER).toBeGreaterThan(2);
  });

  it("leaves real games and their records alone", async () => {
    const gameId = await startGame(app, alice, bob);
    await importPgn(alice, MATE("alice", "bob"));
    const h2h = (await app.inject({ method: "GET", url: "/api/users/bob", cookies: { sessionId: alice } })).json().h2h;
    expect(h2h).toEqual({ wins: 0, draws: 0, losses: 0 });
    expect((await app.inject({ method: "GET", url: `/api/games/${gameId}`, cookies: { sessionId: alice } })).statusCode).toBe(200);
  });
});