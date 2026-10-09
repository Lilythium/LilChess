export interface ArenaCandidate {
  id: number;
  points: number;
  /** Who they played last, so the same two are not paired back to back. */
  lastOpponentId: number | null;
  /** When they became free to play (ms). Longest-waiting first among equals. */
  idleSince: number;
  whites: number;
  blacks: number;
}

export interface ArenaPairing {
  whiteId: number;
  blackId: number;
}

/** After waiting this long a player may be re-paired with their last opponent. */
export const ARENA_REMATCH_AFTER_MS = 20_000;

/**
 * Pairs the players who are free right now, closest in standing first. Anyone who cannot be paired
 * without an immediate rematch is left for the next pass (or paired anyway once they have waited long).
 */
export function arenaPairings(candidates: ArenaCandidate[], now: number): ArenaPairing[] {
  const pool = [...candidates].sort((a, b) => b.points - a.points || a.idleSince - b.idleSince || a.id - b.id);
  const taken = new Set<number>();
  const pairings: ArenaPairing[] = [];

  const mayMeet = (a: ArenaCandidate, b: ArenaCandidate) => {
    const rematch = a.lastOpponentId === b.id || b.lastOpponentId === a.id;
    if (!rematch) return true;
    return pool.length === 2 || now - Math.max(a.idleSince, b.idleSince) >= ARENA_REMATCH_AFTER_MS;
  };

  for (const player of pool) {
    if (taken.has(player.id)) continue;
    const opponent = pool.find((other) => other.id !== player.id && !taken.has(other.id) && mayMeet(player, other));
    if (!opponent) continue;
    taken.add(player.id);
    taken.add(opponent.id);
    const balance = (p: ArenaCandidate) => p.whites - p.blacks;
    const playerWhite = balance(player) === balance(opponent) ? true : balance(player) < balance(opponent);
    pairings.push(playerWhite ? { whiteId: player.id, blackId: opponent.id } : { whiteId: opponent.id, blackId: player.id });
  }
  return pairings;
}
