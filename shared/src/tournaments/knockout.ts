export interface KnockoutMatch {
  match: number; // 1-based slot within the round
  /** Higher seed. For a bye this is the player who advances. */
  highId: number;
  lowId: number | null; // null = bye
}

export const KNOCKOUT_MAX_LEGS = 3;

export const bracketSize = (playerCount: number) => 2 ** Math.ceil(Math.log2(Math.max(playerCount, 2)));
export const knockoutRoundCount = (playerCount: number) => Math.log2(bracketSize(playerCount));

/** Standard seeding order: [1, 8, 4, 5, 2, 7, 3, 6] for 8, so 1 and 2 can only meet in the final. */
export function seedOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const next = order.length * 2 + 1;
    order = order.flatMap((seed) => [seed, next - seed]);
  }
  return order;
}

/** Round one for players listed best seed first. Missing seeds become byes for the top seeds. */
export function firstRound(idsBySeed: number[]): KnockoutMatch[] {
  if (idsBySeed.length < 2) throw new RangeError("A knockout needs at least two players");
  const order = seedOrder(bracketSize(idsBySeed.length));
  const matches: KnockoutMatch[] = [];
  for (let i = 0; i < order.length; i += 2) {
    const high = idsBySeed[order[i]! - 1];
    const low = idsBySeed[order[i + 1]! - 1] ?? null;
    matches.push({ match: i / 2 + 1, highId: high!, lowId: low });
  }
  return matches;
}

/** Later rounds: winners listed in match order, pairing slot 1 with 2, 3 with 4... `seedOf` decides who is "high". */
export function nextRound(winnersInMatchOrder: number[], seedOf: (id: number) => number): KnockoutMatch[] {
  if (winnersInMatchOrder.length % 2 !== 0) throw new RangeError("Winners must come in pairs");
  const matches: KnockoutMatch[] = [];
  for (let i = 0; i < winnersInMatchOrder.length; i += 2) {
    const [a, b] = [winnersInMatchOrder[i]!, winnersInMatchOrder[i + 1]!];
    const [high, low] = seedOf(a) <= seedOf(b) ? [a, b] : [b, a];
    matches.push({ match: i / 2 + 1, highId: high, lowId: low });
  }
  return matches;
}

export interface Leg {
  whiteId: number;
  blackId: number;
  /** undefined: still being played. */
  result?: "1-0" | "0-1" | "1/2-1/2";
  /** The player who forfeited (aborted game or no-show); loses the whole match. */
  forfeitBy?: number | null;
}

export type MatchOutcome =
  | { status: "pending" }
  | { status: "tiebreak"; nextWhiteId: number; nextBlackId: number }
  | { status: "decided"; winnerId: number; loserId: number; bySeed: boolean };

/**
 * Decides a knockout match from its legs. A decisive game or a forfeit settles it. A draw replays the
 * game with colours swapped, up to KNOCKOUT_MAX_LEGS games in total; if the last one is drawn too,
 * the higher seed advances.
 */
export function matchOutcome(highId: number, lowId: number, legs: Leg[], seedOf: (id: number) => number): MatchOutcome {
  const loser = (id: number) => (id === highId ? lowId : highId);
  for (const leg of legs) {
    if (leg.forfeitBy != null) return { status: "decided", winnerId: loser(leg.forfeitBy), loserId: leg.forfeitBy, bySeed: false };
  }
  const last = legs.at(-1);
  if (!last || last.result === undefined) return { status: "pending" };
  if (last.result !== "1/2-1/2") {
    const winnerId = last.result === "1-0" ? last.whiteId : last.blackId;
    return { status: "decided", winnerId, loserId: loser(winnerId), bySeed: false };
  }
  if (legs.length >= KNOCKOUT_MAX_LEGS) {
    const winnerId = seedOf(highId) <= seedOf(lowId) ? highId : lowId;
    return { status: "decided", winnerId, loserId: loser(winnerId), bySeed: true };
  }
  return { status: "tiebreak", nextWhiteId: last.blackId, nextBlackId: last.whiteId };
}
