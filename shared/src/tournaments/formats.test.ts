import { describe, expect, it } from "vitest";
import { arenaPairings, ARENA_REMATCH_AFTER_MS } from "./arena.js";
import { bracketSize, firstRound, KNOCKOUT_MAX_LEGS, matchOutcome, nextRound, seedOrder } from "./knockout.js";
import { arenaScore, computeStandings } from "./standings.js";
import { defaultSwissRounds, swissRound, type SwissPlayer } from "./swiss.js";
import type { ScoredGame } from "./types.js";

const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1, seed: i + 1 }));

describe("standings", () => {
  it("scores 1 / ½ / 0 with a bye counting as a win", () => {
    const games: ScoredGame[] = [
      { round: 1, whiteId: 1, blackId: 2, result: "1-0" },
      { round: 1, whiteId: 3, blackId: null, result: null, bye: true },
      { round: 2, whiteId: 3, blackId: 1, result: "1/2-1/2" },
    ];
    const table = computeStandings("swiss", players(3), games);
    expect(table.map((r) => [r.id, r.points])).toEqual([[1, 1.5], [3, 1.5], [2, 0]]);
  });

  it("breaks swiss ties on Buchholz, then Sonneborn-Berger", () => {
    // 1, 2 and 3 all finish on 1 point. Buchholz: 1 -> 1, 3 -> 1, 2 -> 0. Between 1 and 3, 1 beat 3 (SB 1 vs 0).
    const games: ScoredGame[] = [
      { round: 1, whiteId: 1, blackId: 3, result: "1-0" },
      { round: 1, whiteId: 2, blackId: 4, result: "1-0" },
      { round: 2, whiteId: 3, blackId: 4, result: "1-0" },
    ];
    const table = computeStandings("swiss", players(4), games);
    expect(table.map((r) => r.id)).toEqual([1, 3, 2, 4]);
    expect(table[2]!.buchholz).toBe(0);
  });

  it("breaks round robin ties on Sonneborn-Berger", () => {
    const games: ScoredGame[] = [
      { round: 1, whiteId: 1, blackId: 2, result: "1/2-1/2" },
      { round: 1, whiteId: 3, blackId: 4, result: "1-0" },
      { round: 2, whiteId: 1, blackId: 4, result: "1-0" },
      { round: 2, whiteId: 2, blackId: 3, result: "1-0" },
    ];
    // 1: 1.5, 2: 1.5, 3: 1, 4: 0. SB(1) = ½·1.5 + 0 = 0.75, SB(2) = ½·1.5 + 1 = 1.75.
    expect(computeStandings("round_robin", players(4), games).map((r) => r.id)).toEqual([2, 1, 3, 4]);
  });

  it("ignores voided games", () => {
    const table = computeStandings("round_robin", players(2), [{ round: 1, whiteId: 1, blackId: 2, result: null }]);
    expect(table.every((r) => r.points === 0 && r.gamesPlayed === 0)).toBe(true);
  });

  describe("arena", () => {
    it("doubles points after two wins in a row, and any non-win resets the streak", () => {
      expect(arenaScore("win", 0, true)).toBe(2);
      expect(arenaScore("win", 2, true)).toBe(4);
      expect(arenaScore("draw", 2, true)).toBe(2);
      expect(arenaScore("loss", 5, true)).toBe(0);
      expect(arenaScore("win", 5, false)).toBe(2);

      const wins = (n: number): ScoredGame[] =>
        Array.from({ length: n }, (_, i) => ({ round: 1, whiteId: 1, blackId: 2, result: "1-0" as const, at: i }));
      const row = computeStandings("arena", players(2), wins(4)).find((r) => r.id === 1)!;
      expect(row.points).toBe(2 + 2 + 4 + 4);
      expect(row.onFire).toBe(true);

      const broken = computeStandings("arena", players(2), [
        ...wins(2),
        { round: 1, whiteId: 2, blackId: 1, result: "1/2-1/2", at: 2 },
        { round: 1, whiteId: 1, blackId: 2, result: "1-0", at: 3 },
      ]).find((r) => r.id === 1)!;
      expect(broken.points).toBe(2 + 2 + 2 + 2); // the draw (worth 2 on fire) ended the streak
      expect(broken.onFire).toBe(false);
    });

    it("scores in chronological order regardless of input order", () => {
      const games: ScoredGame[] = [
        { round: 1, whiteId: 1, blackId: 2, result: "1-0", at: 3 },
        { round: 1, whiteId: 1, blackId: 2, result: "1-0", at: 1 },
        { round: 1, whiteId: 1, blackId: 2, result: "1-0", at: 2 },
      ];
      expect(computeStandings("arena", players(2), games).find((r) => r.id === 1)!.points).toBe(2 + 2 + 4);
    });
  });
});

describe("swiss", () => {
  it("defaults to ceil(log2 n) rounds, capped at n - 1", () => {
    expect([2, 3, 4, 5, 8, 9, 16, 17].map(defaultSwissRounds)).toEqual([1, 2, 2, 3, 3, 4, 4, 5]);
    expect(() => defaultSwissRounds(1)).toThrow();
  });

  it("pairs the top half against the bottom half of a score group", () => {
    const pool: SwissPlayer[] = players(8).map((p) => ({ ...p, points: 0, opponents: [], colors: [], hadBye: false }));
    const round = swissRound(pool);
    expect(round.byeId).toBeNull();
    expect(round.pairings.map((p) => [p.whiteId, p.blackId].sort((a, b) => a - b))).toEqual([[1, 5], [2, 6], [3, 7], [4, 8]]);
  });

  it("gives the bye to the lowest-ranked player without one", () => {
    const pool: SwissPlayer[] = players(5).map((p) => ({ ...p, points: 0, opponents: [], colors: [], hadBye: p.id === 5 }));
    expect(swissRound(pool).byeId).toBe(4);
  });

  it("never repeats a pairing over a whole simulated event, for any size", () => {
    let seed = 12345;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let n = 2; n <= 24; n++) {
      const state = new Map<number, SwissPlayer>(players(n).map((p) => [p.id, { ...p, points: 0, opponents: [], colors: [], hadBye: false }]));
      const byes = new Set<number>();
      for (let r = 0; r < defaultSwissRounds(n); r++) {
        const round = swissRound([...state.values()]);
        const seen = new Set<number>();
        for (const { whiteId, blackId } of round.pairings) {
          expect(seen.has(whiteId) || seen.has(blackId)).toBe(false);
          seen.add(whiteId); seen.add(blackId);
          const w = state.get(whiteId)!; const b = state.get(blackId)!;
          expect(w.opponents).not.toContain(blackId);
          w.opponents.push(blackId); b.opponents.push(whiteId);
          w.colors.push("w"); b.colors.push("b");
          const roll = rand();
          if (roll < 0.4) w.points += 1; else if (roll < 0.8) b.points += 1; else { w.points += 0.5; b.points += 0.5; }
        }
        if (round.byeId !== null) {
          expect(byes.has(round.byeId)).toBe(false);
          byes.add(round.byeId);
          seen.add(round.byeId);
          const p = state.get(round.byeId)!;
          p.hadBye = true; p.points += 1;
        }
        expect(seen.size).toBe(n);
        expect(round.rematches).toBe(0);
      }
    }
  });

  it("never gives anyone three of the same colour in a row when avoidable", () => {
    const a: SwissPlayer = { id: 1, seed: 1, points: 2, opponents: [], colors: ["w", "w"], hadBye: false };
    const b: SwissPlayer = { id: 2, seed: 2, points: 2, opponents: [], colors: ["b", "w"], hadBye: false };
    expect(swissRound([a, b]).pairings[0]).toEqual({ whiteId: 2, blackId: 1 });
  });

  it("falls back to a rematch only when nothing else is possible", () => {
    const a: SwissPlayer = { id: 1, seed: 1, points: 1, opponents: [2], colors: ["w"], hadBye: false };
    const b: SwissPlayer = { id: 2, seed: 2, points: 0, opponents: [1], colors: ["b"], hadBye: false };
    const round = swissRound([a, b]);
    expect(round.rematches).toBe(1);
    expect(round.pairings).toHaveLength(1);
  });
});

describe("knockout", () => {
  it("uses standard seeding", () => {
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    expect(seedOrder(2)).toEqual([1, 2]);
  });

  it("gives the top seeds byes when the field is not a power of two", () => {
    const matches = firstRound([10, 20, 30, 40, 50, 60]); // seeds 1..6, bracket of 8
    const byes = matches.filter((m) => m.lowId === null).map((m) => m.highId);
    expect(byes.sort()).toEqual([10, 20]);
    expect(matches.map((m) => [m.highId, m.lowId])).toEqual([[10, null], [40, 50], [20, null], [30, 60]]);
  });

  it("builds a bracket for every size, with each player appearing exactly once", () => {
    for (let n = 2; n <= 40; n++) {
      const ids = players(n).map((p) => p.id);
      const matches = firstRound(ids);
      expect(matches).toHaveLength(bracketSize(n) / 2);
      const seen = matches.flatMap((m) => (m.lowId === null ? [m.highId] : [m.highId, m.lowId]));
      expect([...seen].sort((a, b) => a - b)).toEqual(ids);
      expect(matches.filter((m) => m.lowId === null)).toHaveLength(bracketSize(n) - n);
    }
  });

  it("pairs winners slot by slot, higher seed listed first", () => {
    expect(nextRound([4, 2, 3, 1], (id) => id).map((m) => [m.match, m.highId, m.lowId])).toEqual([[1, 2, 4], [2, 1, 3]]);
  });

  describe("matchOutcome", () => {
    const seedOf = (id: number) => id;
    it("is pending until the game ends", () => {
      expect(matchOutcome(1, 2, [{ whiteId: 1, blackId: 2 }], seedOf)).toEqual({ status: "pending" });
    });
    it("decides on a win and on a forfeit, even after draws", () => {
      expect(matchOutcome(1, 2, [{ whiteId: 1, blackId: 2, result: "0-1" }], seedOf)).toMatchObject({ winnerId: 2, loserId: 1 });
      expect(matchOutcome(1, 2, [
        { whiteId: 1, blackId: 2, result: "1/2-1/2" },
        { whiteId: 2, blackId: 1, forfeitBy: 2 },
      ], seedOf)).toMatchObject({ winnerId: 1, loserId: 2 });
    });
    it("replays a draw with colours swapped", () => {
      expect(matchOutcome(1, 2, [{ whiteId: 1, blackId: 2, result: "1/2-1/2" }], seedOf))
        .toEqual({ status: "tiebreak", nextWhiteId: 2, nextBlackId: 1 });
    });
    it("hands the match to the higher seed after the last drawn game", () => {
      const legs = Array.from({ length: KNOCKOUT_MAX_LEGS }, (_, i) => ({
        whiteId: i % 2 ? 2 : 1, blackId: i % 2 ? 1 : 2, result: "1/2-1/2" as const,
      }));
      expect(matchOutcome(1, 2, legs, seedOf)).toEqual({ status: "decided", winnerId: 1, loserId: 2, bySeed: true });
    });
  });
});

describe("arena pairing", () => {
  const candidate = (id: number, points: number, extra: Partial<Parameters<typeof arenaPairings>[0][number]> = {}) =>
    ({ id, points, lastOpponentId: null, idleSince: 0, whites: 0, blacks: 0, ...extra });

  it("pairs the closest standings and leaves an odd player waiting", () => {
    const pairs = arenaPairings([candidate(1, 6), candidate(2, 5), candidate(3, 1), candidate(4, 0), candidate(5, 0)], 1000);
    expect(pairs).toHaveLength(2);
    const sets = pairs.map((p) => new Set([p.whiteId, p.blackId]));
    expect(sets[0]).toEqual(new Set([1, 2]));
    expect(sets[1]).toEqual(new Set([3, 4]));
  });

  it("does not repeat the last opponent straight away, unless only two are left", () => {
    const three = [candidate(1, 4, { lastOpponentId: 2 }), candidate(2, 4, { lastOpponentId: 1 }), candidate(3, 0)];
    const pairs = arenaPairings(three, 1000);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.whiteId === 3 || pairs[0]!.blackId === 3).toBe(true);

    const two = [candidate(1, 4, { lastOpponentId: 2 }), candidate(2, 4, { lastOpponentId: 1 })];
    expect(arenaPairings(two, 1000)).toHaveLength(1);
  });

  it("allows a rematch after a long wait", () => {
    const pool = [candidate(1, 4, { lastOpponentId: 2, idleSince: 0 }), candidate(2, 4, { lastOpponentId: 1, idleSince: 0 }), candidate(3, 9, { idleSince: 0 })];
    expect(arenaPairings(pool, ARENA_REMATCH_AFTER_MS + 1).length).toBe(1);
    // 3 is paired with the closest standing; 1 and 2 stay apart until someone else is free
    expect(arenaPairings(pool, 1000).length).toBe(1);
  });

  it("gives white to the player with fewer whites", () => {
    const [pair] = arenaPairings([candidate(1, 2, { whites: 3 }), candidate(2, 2, { blacks: 3 })], 0);
    expect(pair).toEqual({ whiteId: 2, blackId: 1 });
  });
});
