import { describe, expect, it } from "vitest";
import { computeStandings, performanceRating } from "./standings.js";
import type { ScoredGame, StandingPlayer } from "./types.js";

const game = (whiteId: number, blackId: number, result: ScoredGame["result"]): ScoredGame => ({ round: 1, whiteId, blackId, result });

describe("performanceRating", () => {
  it("is the average opponent rating when the score is 50%", () => {
    expect(performanceRating([1400, 1600], 1)).toBe(1500);
  });
  it("rises above the average for a good score and falls below it for a bad one", () => {
    expect(performanceRating([1500, 1500, 1500, 1500], 3)).toBe(1691); // 75%: +191
    expect(performanceRating([1500, 1500, 1500, 1500], 1)).toBe(1309); // 25%: -191
  });
  it("clamps perfect and zero scores instead of returning infinity", () => {
    expect(performanceRating([1500, 1500], 2)).toBe(1500 + 798);
    expect(performanceRating([1500, 1500], 0)).toBe(1500 - 798);
  });
  it("is undefined without games", () => {
    expect(performanceRating([], 0)).toBeUndefined();
  });
});

describe("simul2 standings", () => {
  // Everyone plays everyone once. A is strong (1800), D is weak (1200).
  const players: StandingPlayer[] = [
    { id: 1, seed: 1, rating: 1800 },
    { id: 2, seed: 2, rating: 1500 },
    { id: 3, seed: 3, rating: 1500 },
    { id: 4, seed: 4, rating: 1200 },
  ];

  it("sums 1 / 0.5 / 0 points per game", () => {
    const games = [
      game(1, 2, "1/2-1/2"), game(1, 3, "1-0"), game(1, 4, "1-0"),
      game(2, 3, "1/2-1/2"), game(2, 4, "1-0"), game(3, 4, "1-0"),
    ];
    const table = computeStandings("simul2", players, games);
    expect(table.map((r) => [r.id, r.points])).toEqual([[1, 2.5], [2, 2], [3, 1.5], [4, 0]]);
  });

  it("ranks a player with the stronger opposition ahead on equal points", () => {
    // Two-game mini field: X (seed 2) drew the 2000, Y (seed 1) drew the 1000. Same points, X performed better.
    const field: StandingPlayer[] = [
      { id: 1, seed: 1, rating: 1500 },
      { id: 2, seed: 2, rating: 1500 },
      { id: 3, seed: 3, rating: 2000 },
      { id: 4, seed: 4, rating: 1000 },
    ];
    const table = computeStandings("simul2", field, [game(2, 3, "1/2-1/2"), game(1, 4, "1/2-1/2")]);
    const [first, second] = table.filter((r) => r.id === 1 || r.id === 2);
    expect(table.findIndex((r) => r.id === 2)).toBeLessThan(table.findIndex((r) => r.id === 1));
    expect(first!.performance).toBeGreaterThan(second!.performance!);
  });

  it("reports performance only for simul2", () => {
    const rr = computeStandings("round_robin", players, [game(1, 2, "1-0")]);
    expect(rr.every((r) => r.performance === undefined)).toBe(true);
    const s2 = computeStandings("simul2", players, [game(1, 2, "1-0")]);
    expect(s2.find((r) => r.id === 3)!.performance).toBeUndefined(); // no games yet
    expect(s2.find((r) => r.id === 1)!.performance).toBe(1500 + 798);
  });

  it("treats players without a stored rating as 1500", () => {
    const table = computeStandings("simul2", [{ id: 1, seed: 1 }, { id: 2, seed: 2 }], [game(1, 2, "1/2-1/2")]);
    expect(table.map((r) => r.performance)).toEqual([1500, 1500]);
  });
});
