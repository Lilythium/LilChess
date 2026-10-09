export interface SwissPlayer {
  id: number;
  seed: number; // lower = better, used to break ties between equal scores
  points: number;
  opponents: number[]; // everyone already played
  colors: ("w" | "b")[]; // colours of previous games, oldest first
  hadBye: boolean;
}

export interface SwissPairing {
  whiteId: number;
  blackId: number;
}

export interface SwissRound {
  pairings: SwissPairing[];
  byeId: number | null;
  /** True when a pairing without repeat opponents could not be found. */
  rematches: number;
}

/** Enough rounds for a clear winner: ceil(log2 n), at least 1, never more than n - 1. */
export function defaultSwissRounds(playerCount: number): number {
  if (playerCount < 2) throw new RangeError("A swiss needs at least two players");
  return Math.min(Math.max(1, Math.ceil(Math.log2(playerCount))), playerCount - 1);
}

const NODE_BUDGET = 200_000;

function rank(players: SwissPlayer[]): SwissPlayer[] {
  return [...players].sort((a, b) => b.points - a.points || a.seed - b.seed);
}

/**
 * Candidate opponents for `first`, best first. Inside the same score group the player is matched
 * with the one half a group away (1v3, 2v4), the usual Dutch shape; after that, nearest score.
 */
function candidatesFor(first: SwissPlayer, rest: SwissPlayer[]): SwissPlayer[] {
  const group = rest.filter((player) => player.points === first.points);
  const others = rest.filter((player) => player.points !== first.points);
  const half = Math.ceil((group.length + 1) / 2) - 1; // index in `group` of the preferred opponent
  const ordered = [...group.slice(half), ...group.slice(0, half)];
  return [...ordered, ...others];
}

function pairAll(players: SwissPlayer[], allowRematch: boolean): { pairs: [SwissPlayer, SwissPlayer][]; rematches: number } | null {
  let nodes = 0;
  const pairs: [SwissPlayer, SwissPlayer][] = [];
  const solve = (pool: SwissPlayer[], rematches: number): number | null => {
    if (pool.length === 0) return rematches;
    if (++nodes > NODE_BUDGET) return null;
    const [first, ...rest] = pool;
    for (const candidate of candidatesFor(first!, rest)) {
      const repeat = first!.opponents.includes(candidate.id);
      if (repeat && !allowRematch) continue;
      pairs.push([first!, candidate]);
      const outcome = solve(rest.filter((player) => player !== candidate), rematches + (repeat ? 1 : 0));
      if (outcome !== null) return outcome;
      pairs.pop();
    }
    return null;
  };
  const rematches = solve(players, 0);
  return rematches === null ? null : { pairs: [...pairs], rematches };
}

/** Colour balance first (fewer whites gets white), then no third identical colour in a row, then alternate. */
export function assignColors(a: SwissPlayer, b: SwissPlayer): SwissPairing {
  const diff = (p: SwissPlayer) => p.colors.filter((c) => c === "w").length - p.colors.filter((c) => c === "b").length;
  const streak = (p: SwissPlayer, color: "w" | "b") => p.colors.length >= 2 && p.colors.slice(-2).every((c) => c === color);
  const aWhite = { whiteId: a.id, blackId: b.id };
  const aBlack = { whiteId: b.id, blackId: a.id };

  if (streak(a, "w") && !streak(b, "w")) return aBlack;
  if (streak(b, "w") && !streak(a, "w")) return aWhite;
  if (streak(a, "b") && !streak(b, "b")) return aWhite;
  if (streak(b, "b") && !streak(a, "b")) return aBlack;
  if (diff(a) !== diff(b)) return diff(a) < diff(b) ? aWhite : aBlack;
  const lastA = a.colors.at(-1);
  const lastB = b.colors.at(-1);
  if (lastA !== lastB) {
    if (lastA === "w" || lastB === "b") return aBlack;
    if (lastA === "b" || lastB === "w") return aWhite;
  }
  return a.seed <= b.seed ? aWhite : aBlack;
}

/**
 * Pairs one swiss round from the players still in the pairing pool.
 * With an odd pool the bye goes to the lowest-ranked player who has not had one yet, trying the next
 * candidate up when removing someone would leave the rest unpairable without a rematch.
 */
export function swissRound(players: SwissPlayer[]): SwissRound {
  if (players.length === 0) return { pairings: [], byeId: null, rematches: 0 };
  const ranked = rank(players);

  const byeOrder: (SwissPlayer | null)[] = [null];
  if (ranked.length % 2 === 1) {
    const fromBottom = [...ranked].reverse();
    byeOrder.splice(0, 1, ...fromBottom.filter((p) => !p.hadBye), ...fromBottom.filter((p) => p.hadBye));
  }

  for (const allowRematch of [false, true]) {
    for (const bye of byeOrder) {
      const pool = bye ? ranked.filter((player) => player !== bye) : ranked;
      const solved = pairAll(pool, allowRematch);
      if (!solved) continue;
      const pairings = solved.pairs
        .map(([a, b]) => ({ pair: assignColors(a, b), top: Math.max(a.points, b.points), seed: Math.min(a.seed, b.seed) }))
        .sort((x, y) => y.top - x.top || x.seed - y.seed)
        .map(({ pair }) => pair);
      return { pairings, byeId: bye?.id ?? null, rematches: solved.rematches };
    }
  }
  throw new Error("swissRound: no pairing found");
}
