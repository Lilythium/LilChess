export interface RoundRobinPairing {
  round: number;
  board: number;
  whiteId: number;
  blackId: number;
}

export function roundRobinPairings(playerIds: number[]): RoundRobinPairing[] {
  if (playerIds.length < 2) throw new RangeError("A round robin requires at least two players");
  if (new Set(playerIds).size !== playerIds.length) throw new RangeError("Player IDs must be unique");

  const slots: (number | null)[] = [...playerIds];
  if (slots.length % 2) slots.push(null);
  const pairings: RoundRobinPairing[] = [];
  const rounds = slots.length - 1;

  for (let round = 0; round < rounds; round++) {
    for (let pair = 0; pair < slots.length / 2; pair++) {
      const left = slots[pair];
      const right = slots[slots.length - 1 - pair];
      if (left != null && right != null) {
        const leftIsWhite = pair === 0 ? round % 2 === 0 : pair % 2 === 0;
        pairings.push({
          round: round + 1,
          board: pair + 1,
          whiteId: leftIsWhite ? left : right,
          blackId: leftIsWhite ? right : left,
        });
      }
    }
    const fixed = slots[0]!;
    const rotating = slots.slice(1);
    rotating.unshift(rotating.pop()!);
    slots.splice(0, slots.length, fixed, ...rotating);
  }
  return pairings;
}