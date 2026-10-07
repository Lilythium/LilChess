import { describe, expect, it } from "vitest";
import { roundRobinPairings } from "./roundRobin.js";

describe("roundRobinPairings", () => {
  it("pairs every player exactly once in each round and every opponent pair once", () => {
    for (let count = 2; count <= 16; count++) {
      const pairings = roundRobinPairings(Array.from({ length: count }, (_, index) => index + 1));
      const expectedRounds = count % 2 === 0 ? count - 1 : count;
      expect(new Set(pairings.map((pairing) => pairing.round)).size).toBe(expectedRounds);

      for (let round = 1; round <= expectedRounds; round++) {
        const roundPairings = pairings.filter((pairing) => pairing.round === round);
        const players = roundPairings.flatMap(({ whiteId, blackId }) => [whiteId, blackId]);
        expect(new Set(players).size).toBe(players.length);
        expect(players.length).toBe(count - count % 2);
      }

      const opponents = pairings.map(({ whiteId, blackId }) => [whiteId, blackId].sort((a, b) => a - b).join(":"));
      expect(new Set(opponents).size).toBe(count * (count - 1) / 2);
      expect(pairings).toHaveLength(count * (count - 1) / 2);
    }
  });

  it("keeps each player's color imbalance within the round-robin bound", () => {
    for (let count = 2; count <= 16; count++) {
      const pairings = roundRobinPairings(Array.from({ length: count }, (_, index) => index + 1));
      const bound = count % 2 === 0 ? 1 : 2;
      for (let player = 1; player <= count; player++) {
        const white = pairings.filter((pairing) => pairing.whiteId === player).length;
        const black = pairings.filter((pairing) => pairing.blackId === player).length;
        expect(Math.abs(white - black)).toBeLessThanOrEqual(bound);
      }
    }
  });

  it("rejects duplicate players and schedules with fewer than two players", () => {
    expect(() => roundRobinPairings([1])).toThrow(RangeError);
    expect(() => roundRobinPairings([1, 1])).toThrow(RangeError);
  });
});