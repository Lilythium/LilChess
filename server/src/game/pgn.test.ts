import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { closeDb, openDb } from "../db/connection.js";
import { registerUser, startGame } from "../testing/helpers.js";

describe("GET /api/games/:id/pgn", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    openDb(":memory:");
    app = await buildApp();
  });
  afterEach(async () => {
    await app.close();
    closeDb();
  });

  it("downloads the game as PGN", async () => {
    const alice = await registerUser(app, "alice");
    const bob = await registerUser(app, "bob");
    const gameId = await startGame(app, alice, bob);
    await app.inject({
      method: "POST",
      url: `/api/games/${gameId}/move`,
      cookies: { sessionId: alice },
      payload: { ply: 0, uci: "e2e4" },
    });

    const res = await app.inject({ method: "GET", url: `/api/games/${gameId}/pgn`, cookies: { sessionId: bob } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/x-chess-pgn");
    expect(res.headers["content-disposition"]).toContain(`lilchess-${gameId}.pgn`);
    expect(res.body).toContain('[White "alice"]');
    expect(res.body).toContain('[Black "bob"]');
    expect(res.body).toContain("1. e4 *");
  });

  it("imports valid PGN and exposes it in the user history", async () => {
    const alice = await registerUser(app, "alice");
    const pgn = `[Event "Import test"]
[White "alice"]
[Black "bob"]
[Result "1-0"]

1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0`;

    const res = await app.inject({
      method: "POST",
      url: "/api/games/import",
      cookies: { sessionId: alice },
      payload: { pgn },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(res.json().imported).toHaveLength(1);

    const list = await app.inject({ method: "GET", url: "/api/games/my-games", cookies: { sessionId: alice } });
    expect(list.statusCode).toBe(200);
    const data = list.json();
    expect(data.finished.length).toBeGreaterThanOrEqual(1);
    expect(data.finished[0].white_name).toBe("alice");
    expect(data.finished[0].black_name).toBe("bob");
  });

  it("accepts Lichess PGNs with clock comments and time-forfeit termination", async () => {
    const alice = await registerUser(app, "alice");
    const pgn = `[Event "rated bullet game"]
[Site "https://lichess.org/a1kAx4Dn"]
[Date "2026.10.10"]
[Round "-"]
[White "KomronARM"]
[Black "lilythium"]
[Result "0-1"]
[GameId "a1kAx4Dn"]
[UTCDate "2026.10.10"]
[UTCTime "15:27:29"]
[WhiteElo "2153"]
[BlackElo "2165"]
[WhiteRatingDiff "-5"]
[BlackRatingDiff "+5"]
[Variant "Standard"]
[TimeControl "60+0"]
[ECO "B13"]
[Opening "Caro-Kann Defense: Exchange Variation"]
[Termination "Time forfeit"]
[Annotator "lichess.org"]

1. e4 { [%clk 0:01:00] } 1... c6 { [%clk 0:01:00] } 2. d4 { [%clk 0:00:23] } 2... d5 { [%clk 0:01:00] } 3. exd5 { [%clk 0:00:22] } 3... cxd5 { [%clk 0:01:00] } { B13 Caro-Kann Defense: Exchange Variation } 4. Nf3 { [%clk 0:00:22] } 4... Nf6 { [%clk 0:00:58] } 5. Bd3 { [%clk 0:00:22] } 5... Nc6 { [%clk 0:00:58] } 6. c3 { [%clk 0:00:22] } 6... Bg4 { [%clk 0:00:58] } 7. O-O { [%clk 0:00:22] } 7... Bxf3 { [%clk 0:00:57] } 8. Qxf3 { [%clk 0:00:22] } 8... e6 { [%clk 0:00:57] } 9. Qg3 { [%clk 0:00:21] } 9... Qb8 { [%clk 0:00:55] } 10. Qxb8+ { [%clk 0:00:20] } 10... Rxb8 { [%clk 0:00:55] } 11. Nd2 { [%clk 0:00:19] } 11... Bd6 { [%clk 0:00:54] } 12. Nf3 { [%clk 0:00:19] } 12... Ng4 { [%clk 0:00:53] } 13. Re1 { [%clk 0:00:19] } 13... O-O { [%clk 0:00:51] } 14. h3 { [%clk 0:00:19] } 14... Nf6 { [%clk 0:00:50] } 15. Ne5 { [%clk 0:00:18] } 15... Nxe5 { [%clk 0:00:49] } 16. dxe5 { [%clk 0:00:18] } 16... Nd7 { [%clk 0:00:48] } 17. exd6 { [%clk 0:00:17] } 17... Rbd8 { [%clk 0:00:47] } 18. Bf4 { [%clk 0:00:17] } 18... Nf6 { [%clk 0:00:46] } 19. Bg3 { [%clk 0:00:17] } 19... Nh5 { [%clk 0:00:45] } 20. Bc2 { [%clk 0:00:17] } 20... Nxg3 { [%clk 0:00:44] } 21. fxg3 { [%clk 0:00:17] } 21... Rxd6 { [%clk 0:00:43] } 22. Rad1 { [%clk 0:00:17] } 22... Rb6 { [%clk 0:00:43] } 23. Kf1 { [%clk 0:00:17] } 23... Rxb2 { [%clk 0:00:42] } 24. Re2 { [%clk 0:00:16] } 24... Rc8 { [%clk 0:00:41] } 25. Bxh7+ { [%clk 0:00:15] } 25... Kxh7 { [%clk 0:00:39] } 26. Rxb2 { [%clk 0:00:15] } 26... b6 { [%clk 0:00:38] } 27. Rc1 { [%clk 0:00:13] } 27... d4 { [%clk 0:00:37] } 28. a4 { [%clk 0:00:13] } 28... dxc3 { [%clk 0:00:36] } 29. Rbc2 { [%clk 0:00:13] } 29... Rc5 { [%clk 0:00:33] } 30. Rxc3 { [%clk 0:00:13] } 30... Ra5 { [%clk 0:00:33] } 31. Rc4 { [%clk 0:00:12] } 31... Kg6 { [%clk 0:00:32] } 32. Rd1 { [%clk 0:00:12] } 32... Kf6 { [%clk 0:00:31] } 33. Kf2 { [%clk 0:00:10] } 33... g6 { [%clk 0:00:31] } 34. Kf3 { [%clk 0:00:10] } 34... Kg7 { [%clk 0:00:31] } 35. Rd7 { [%clk 0:00:09] } 35... Ra6 { [%clk 0:00:29] } 36. Rcc7 { [%clk 0:00:09] } 36... Rxa4 { [%clk 0:00:28] } 37. Rxf7+ { [%clk 0:00:09] } 37... Kh6 { [%clk 0:00:28] } 38. g4 { [%clk 0:00:08] } 38... Ra3+ { [%clk 0:00:27] } 39. Kf2 { [%clk 0:00:08] } 39... Kg5 { [%clk 0:00:27] } 40. Rcd7 { [%clk 0:00:05] } 40... Ra2+ { [%clk 0:00:27] } 41. Kg3 { [%clk 0:00:04] } 41... Ra3+ { [%clk 0:00:27] } 42. Kh2 { [%clk 0:00:04] } 42... Ra2 { [%clk 0:00:26] } 43. Rf3 { [%clk 0:00:03] } 43... e5 { [%clk 0:00:25] } 44. Rdf7 { [%clk 0:00:03] } 44... e4 { [%clk 0:00:25] } 45. Re3 { [%clk 0:00:03] } 45... Ra4 { [%clk 0:00:24] } 46. Re7 { [%clk 0:00:03] } 46... b5 { [%clk 0:00:23] } 47. R7xe4 { [%clk 0:00:03] } 47... Ra3 { [%clk 0:00:23] } 48. Re6 { [%clk 0:00:01] } 48... b4 { [%clk 0:00:23] } 49. R3e5+ { [%clk 0:00:01] } 49... Kf4 { [%clk 0:00:21] } 50. g3+ { [%clk 0:00:01] } 50... Kf3 { [%clk 0:00:21] } 51. Re4 { [%clk 0:00:01] } 51... Ra2+ { [%clk 0:00:20] } { Black wins on time. } 0-1`;

    const res = await app.inject({
      method: "POST",
      url: "/api/games/import",
      cookies: { sessionId: alice },
      payload: { pgn },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(res.json().imported).toHaveLength(1);
  });

  it("imports multiple games from one PGN file and rejects malformed input", async () => {
    const alice = await registerUser(app, "alice");
    const pgn = `[Event "Game 1"]
[White "alice"]
[Black "bob"]
[Result "1-0"]

1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0

[Event "Game 2"]
[White "alice"]
[Black "carol"]
[Result "1-0"]

1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0`;

    const imported = await app.inject({
      method: "POST",
      url: "/api/games/import",
      cookies: { sessionId: alice },
      payload: { pgn },
    });
    expect(imported.statusCode).toBe(200);
    expect(imported.json().imported).toHaveLength(2);

    const bad = await app.inject({
      method: "POST",
      url: "/api/games/import",
      cookies: { sessionId: alice },
      payload: { pgn: "1. e4 e5 2. Qh5 ???" },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toMatch(/PGN|illegal|unsupported/i);
  });

  it("404s for an unknown game and 401s without a session", async () => {
    const alice = await registerUser(app, "alice");
    const missing = await app.inject({ method: "GET", url: "/api/games/deadbeef/pgn", cookies: { sessionId: alice } });
    expect(missing.statusCode).toBe(404);

    const anon = await app.inject({ method: "GET", url: "/api/games/deadbeef/pgn" });
    expect(anon.statusCode).toBe(401);
  });
});