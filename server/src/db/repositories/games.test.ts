import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeUci, squareRank } from "chessops/util";
import { applyMove, createGame, fenAfterMoves, positionFromFen } from "@lilchess/shared";
import { openDb, closeDb, getDb } from "../connection.js";
import { backfillSnapshots } from "../backfill.js";
import { checkIntegrity } from "../integrity.js";
import { clearActiveGameCache, getActiveGameCacheStats } from "../../game/activeGameCache.js";
import {
  acceptTakebackAndPersist,
  applyMoveAndPersist,
  claimTimeoutAndPersist,
  getGame,
  getMoveSans,
  insertGame,
  offerTakebackAndPersist,
} from "./games.js";

describe("claimTimeoutAndPersist", () => {
  beforeEach(() => {
    openDb(":memory:");
    const db = getDb();
    db.prepare(
      `INSERT INTO users (id, username, password_hash, created_at) VALUES (1, 'alice', 'x', 0)`,
    ).run();
    db.prepare(
      `INSERT INTO users (id, username, password_hash, created_at) VALUES (2, 'bob', 'x', 0)`,
    ).run();
  });

  afterEach(() => closeDb());

  it("finishes a game whose deadline has passed and persists the result", () => {
    const clock = { mode: "live" as const, initialMs: 60_000, incrementMs: 0 };
    // ply 2: both sides have moved, so the real clock is running
    const game = { ...createGame({ clock, now: 0 }), ply: 2, deadlineAt: 500 };
    insertGame("g1", 1, 2, game);

    const result = claimTimeoutAndPersist("g1", 1_000);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.status).toBe("finished");
    expect(result.state.termination).toBe("timeout");

    // Re-read from the DB, not just the in-memory result, to confirm
    // updateGameState actually persisted it.
    expect(getGame("g1")?.status).toBe("finished");
  });

  it("refuses to claim before the deadline", () => {
    const clock = { mode: "live" as const, initialMs: 60_000, incrementMs: 0 };
    const game = createGame({ clock, now: 0 }); // first-move window ends at 30000
    insertGame("g2", 1, 2, game);

    const result = claimTimeoutAndPersist("g2", 10_000);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("not_yet_expired");
    expect(getGame("g2")?.status).toBe("started");
  });

  it("returns not_found for a game that doesn't exist", () => {
    const result = claimTimeoutAndPersist("does-not-exist", Date.now());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("not_found");
  });

  it("rejects a timeout claim against a deadline a move has already superseded", () => {
    const clock = { mode: "live" as const, initialMs: 60_000, incrementMs: 0 };
    const game = createGame({ clock, now: 0 }); // original first-move deadline: 30000
    insertGame("g3", 1, 2, game);

    // White moves at 20s, which gives black a fresh window ending at 50000.
    const moveResult = applyMoveAndPersist("g3", "e2e4", 20_000);
    expect(moveResult.ok).toBe(true);

    // A timeout claim carrying the ORIGINAL deadline is now stale.
    // claimTimeoutAndPersist re-reads the game fresh inside its own
    // transaction rather than trusting the caller's "now" against a
    // remembered deadline, so this correctly no-ops instead of ending
    // the game out from under the move that just landed.
    const claim = claimTimeoutAndPersist("g3", 30_001);
    expect(claim.ok).toBe(false);
    if (claim.ok) return;
    expect(claim.error).toBe("not_yet_expired");

    expect(getGame("g3")?.moves).toEqual(["e2e4"]);
    expect(getGame("g3")?.status).toBe("started");
  });

  it("aborts a live game nobody moved in, instead of awarding a timeout win", () => {
    const clock = { mode: "live" as const, initialMs: 60_000, incrementMs: 0 };
    insertGame("g4", 1, 2, createGame({ clock, now: 0 })); // window ends at 30000

    const result = claimTimeoutAndPersist("g4", 31_000);
    expect(result.ok).toBe(true);
    expect(getGame("g4")?.status).toBe("aborted");
    expect(getGame("g4")?.termination).toBe("abort");
    expect(getGame("g4")?.result).toBeUndefined();
  });
});

describe("takebacks", () => {
  beforeEach(() => {
    // Mock the system time so that acceptance checks don't instantly timeout
    vi.useFakeTimers();
    vi.setSystemTime(1500); 

    openDb(":memory:");
    const db = getDb();
    db.prepare(`INSERT INTO users (id, username, password_hash, created_at) VALUES (1, 'alice', 'x', 0)`).run();
    db.prepare(`INSERT INTO users (id, username, password_hash, created_at) VALUES (2, 'bob', 'x', 0)`).run();
    const clock = { mode: "live" as const, initialMs: 60_000, incrementMs: 0 };
    insertGame("tb1", 1, 2, createGame({ clock, now: 0 })); // alice = white
  });

  afterEach(() => {
    closeDb();
    vi.useRealTimers();
  });

  it("removes the retracted move and restores the turn", () => {
    expect(applyMoveAndPersist("tb1", "e2e4", 1_000).ok).toBe(true);
    expect(offerTakebackAndPersist("tb1", 1).ok).toBe(true);
    expect(getGame("tb1")?.takebackOfferedBy).toBe("white");

    expect(acceptTakebackAndPersist("tb1", 2).ok).toBe(true);

    const g = getGame("tb1")!;
    expect(g.moves).toEqual([]);
    expect(g.ply).toBe(0);
    expect(g.turn).toBe("white");
    expect(g.takebackOfferedBy).toBeUndefined();
    expect(getMoveSans("tb1")).toEqual([]);
    expect(getDb().prepare(`SELECT ply, uci FROM moves WHERE game_id = 'tb1'`).all())
      .toEqual([{ ply: 1, uci: "e2e4" }]);
  });

  it("lets the game continue with a different move afterwards", () => {
    applyMoveAndPersist("tb1", "e2e4", 1_000);
    offerTakebackAndPersist("tb1", 1);
    acceptTakebackAndPersist("tb1", 2);

    const res = applyMoveAndPersist("tb1", "d2d4", 2_000);
    expect(res.ok).toBe(true);
    expect(getGame("tb1")?.moves).toEqual(["d2d4"]);
    expect(getMoveSans("tb1")).toEqual(["d4"]);
    expect(getDb().prepare(`SELECT ply, uci, played_at FROM moves WHERE game_id = 'tb1' ORDER BY id`).all())
      .toEqual([
        { ply: 1, uci: "e2e4", played_at: 1_000 },
        { ply: 1, uci: "d2d4", played_at: 2_000 },
      ]);
  });

  it("refuses an offer before the requester has moved", () => {
    const res = offerTakebackAndPersist("tb1", 1);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("nothing_to_take_back");
  });

  it("only participants can offer", () => {
    const res = offerTakebackAndPersist("tb1", 99);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("not_a_participant");
  });
});
describe("position snapshots", () => {
  const clock = { mode: "live" as const, initialMs: 3 * 3_600_000, incrementMs: 0 };
  // A deterministic pseudo-random game that is still running after `n` plies (a shuffle would end by repetition).
  const LONG_GAME_PLIES = 130;
  let longGame: string[] | undefined;
  const movesFor = (n: number): string[] => (longGame ??= buildLongGame(LONG_GAME_PLIES)).slice(0, n);

  function buildLongGame(n: number): string[] {
    for (let seed = 1; seed < 200; seed++) {
      let a = seed;
      const rnd = () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      let g = createGame({ clock, now: 0 });
      const out: string[] = [];
      while (g.status === "started" && out.length < n) {
        const pos = positionFromFen(fenAfterMoves(g.initialFen, g.moves)!);
        const all: string[] = [];
        for (const [from, dests] of pos.allDests()) {
          const pawn = pos.board.get(from)?.role === "pawn";
          for (const to of dests) {
            const last = squareRank(to) === 0 || squareRank(to) === 7;
            all.push(makeUci({ from, to, promotion: pawn && last ? "queen" : undefined }));
          }
        }
        if (!all.length) break;
        const uci = all[Math.floor(rnd() * all.length)]!;
        const r = applyMove(g, uci, 1_000 + out.length);
        if (!r.ok) break;
        out.push(uci);
        g = r.state;
      }
      if (out.length === n && g.status === "started") return out;
    }
    throw new Error("no long game found");
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_500); // keeps the takeback deadline check from firing
    openDb(":memory:");
    getDb().prepare(`INSERT INTO users (id, username, password_hash, created_at) VALUES (1,'a','x',0),(2,'b','x',0)`).run();
    insertGame("g1", 1, 2, createGame({ clock, now: 0 }));
  });
  afterEach(() => {
    closeDb();
    vi.useRealTimers();
  });

  const snapshotPlies = () =>
    (getDb().prepare(`SELECT ply FROM game_snapshots WHERE game_id='g1' ORDER BY ply`).pluck().all() as number[]);

  function playTo(ply: number) {
    for (const [i, uci] of movesFor(ply).entries()) {
      const r = applyMoveAndPersist("g1", uci, 1_000 + i);
      if (!r.ok) throw new Error(`${uci}: ${r.error}`);
    }
  }

  it("stores a checkpoint every 50 plies", () => {
    playTo(120);
    expect(snapshotPlies()).toEqual([50, 100]);
  });

  it("keeps the stored position equal to a full replay after the checkpoint is used", () => {
    playTo(130);
    const g = getGame("g1")!;
    const stored = getDb().prepare(`SELECT fen FROM games WHERE id='g1'`).pluck().get();
    expect(stored).toBe(fenAfterMoves(g.initialFen, g.moves, g.variant));
  });

  it("plays the same game with a cached position as with a cold replay every move", () => {
    const moves = movesFor(130);
    const play = (id: string, cold: boolean) => {
      for (const [i, uci] of moves.entries()) {
        if (cold) clearActiveGameCache(); // forces a rebuild from SQLite (checkpoint + replay) each move
        const r = applyMoveAndPersist(id, uci, 1_000 + i);
        if (!r.ok) throw new Error(`${id} ${uci}: ${r.error}`);
      }
    };

    play("g1", false);
    insertGame("g2", 1, 2, createGame({ clock, now: 0 }));
    play("g2", true);

    expect(getMoveSans("g1")).toEqual(getMoveSans("g2"));
    const fenOfGame = (id: string) => getDb().prepare(`SELECT fen FROM games WHERE id = ?`).pluck().get(id);
    expect(fenOfGame("g1")).toBe(fenOfGame("g2"));
    expect(getGame("g1")).toEqual(getGame("g2"));
  });

  it("keeps the cached position intact when a move is rejected", () => {
    const [m1, m2, m3] = movesFor(3) as [string, string, string];
    expect(applyMoveAndPersist("g1", m1, 1_000).ok).toBe(true);
    expect(applyMoveAndPersist("g1", "a1a8", 1_001).ok).toBe(false); // illegal from the cached position
    expect(applyMoveAndPersist("g1", m1, 1_002).ok).toBe(false); // the wrong side's move, now stale
    // The cached position must still be the one after m1, so the real second move is accepted.
    expect(applyMoveAndPersist("g1", m2, 1_003).ok).toBe(true);
    expect(applyMoveAndPersist("g1", m3, 1_004).ok).toBe(true);
    const g = getGame("g1")!;
    expect(getDb().prepare(`SELECT fen FROM games WHERE id='g1'`).pluck().get())
      .toBe(fenAfterMoves(g.initialFen, g.moves, g.variant));
  });

  it("still notices a gap in the move rows by the next checkpoint ply", () => {
    playTo(20);
    // Simulate corruption: lose one row in the middle of the line.
    getDb().prepare(`DELETE FROM active_moves WHERE game_id = 'g1' AND ply = 10`).run();

    // Plies that are not checkpoints only check the top row, so these still go through...
    const moves = movesFor(50);
    for (let i = 20; i < 49; i++) {
      expect(applyMoveAndPersist("g1", moves[i]!, 1_000 + i).ok).toBe(true);
    }
    // ...but the full count at the checkpoint ply (50) refuses to commit on top of a damaged history.
    expect(() => applyMoveAndPersist("g1", moves[49]!, 1_049)).toThrow(/move rows/);
  });

  it("drops checkpoints a takeback retracts and ignores any left stale", () => {
    playTo(101);
    expect(snapshotPlies()).toEqual([50, 100]);
    // White just played ply 101, so black offers the takeback and white accepts, retracting back to ply 99.
    expect(offerTakebackAndPersist("g1", 2).ok).toBe(true);
    expect(acceptTakebackAndPersist("g1", 1).ok).toBe(true);
    expect(getGame("g1")!.ply).toBe(99);
    expect(snapshotPlies()).toEqual([50]);
  });

  it("falls back to a full replay when a checkpoint no longer matches its move row", () => {
    playTo(60);
    // Point the checkpoint at a different (real) move row and wreck its position: it must be ignored, not trusted.
    getDb().prepare(`UPDATE game_snapshots SET move_id = move_id - 1, fen = '8/8/8/8/8/8/8/K6k w - - 0 1', keys = 'x' WHERE game_id='g1'`).run();
    clearActiveGameCache();
    const r = applyMoveAndPersist("g1", movesFor(61)[60]!, 100_000);
    expect(r.ok).toBe(true);
    const g = getGame("g1")!;
    expect(getDb().prepare(`SELECT fen FROM games WHERE id='g1'`).pluck().get()).toBe(fenAfterMoves(g.initialFen, g.moves, g.variant));
  });

  it("reports a checkpoint that disagrees with the replayed position in the deep integrity check", () => {
    playTo(60);
    getDb().prepare(`UPDATE game_snapshots SET fen = '8/8/8/8/8/8/8/K6k w - - 0 1' WHERE game_id='g1'`).run();
    expect(checkIntegrity(getDb(), { deep: true }).some((i) => i.detail.includes("checkpoint at ply 50"))).toBe(true);
  });

  it("backfills checkpoints for a long game that has none", () => {
    playTo(120);
    getDb().prepare(`DELETE FROM game_snapshots`).run();
    expect(backfillSnapshots(getDb())).toBe(1);
    expect(snapshotPlies()).toEqual([50, 100]);
    expect(backfillSnapshots(getDb())).toBe(0);
    expect(checkIntegrity(getDb(), { deep: true })).toEqual([]);
  });
});

describe("active live-game cache", () => {
  beforeEach(() => {
    openDb(":memory:");
    const db = getDb();
    db.prepare(`INSERT INTO users (id, username, password_hash, created_at) VALUES (1, 'alice', 'x', 0)`).run();
    db.prepare(`INSERT INTO users (id, username, password_hash, created_at) VALUES (2, 'bob', 'x', 0)`).run();
    insertGame("cached-live", 1, 2, createGame({
      clock: { mode: "live", initialMs: 60_000, incrementMs: 0 },
      now: 0,
    }));
  });

  afterEach(() => closeDb());

  it("reuses live state while keeping returned state copies isolated", () => {
    const first = getGame("cached-live")!;
    expect(getActiveGameCacheStats().size).toBe(1);

    // A caller must not be able to mutate the object held by the cache.
    first.moves.push("e2e4");
    expect(getGame("cached-live")?.moves).toEqual([]);

    const move = applyMoveAndPersist("cached-live", "e2e4", 1_000);
    expect(move.ok).toBe(true);
    expect(getGame("cached-live")?.moves).toEqual(["e2e4"]);
    expect(getGame("cached-live")?.ply).toBe(1);
    expect(getActiveGameCacheStats().hits).toBeGreaterThan(0);
    expect(getActiveGameCacheStats().size).toBe(1);
  });

  it("removes a game from cache after its terminal state commits", () => {
    getGame("cached-live");
    expect(getActiveGameCacheStats().size).toBe(1);

    const timeout = claimTimeoutAndPersist("cached-live", 31_000);
    expect(timeout.ok).toBe(true);
    expect(getActiveGameCacheStats().size).toBe(0);
    expect(getGame("cached-live")?.status).toBe("aborted");
  });
});
