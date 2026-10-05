import { START_FEN } from "./types.js";
import type { Variant } from "./types.js";

// Which 2 of the 5 squares left after bishops and queen get the knights (Scharnagl numbering).
const KNIGHT_SLOTS: [number, number][] = [
  [0, 1], [0, 2], [0, 3], [0, 4], [1, 2], [1, 3], [1, 4], [2, 3], [2, 4], [3, 4],
];

/** Chess960 start position by Scharnagl id (0..959). 518 is the standard array. */
export function chess960Fen(id: number): string {
  if (!Number.isInteger(id) || id < 0 || id > 959) {
    throw new RangeError(`Chess960 id out of range: ${id}`);
  }
  const rank: string[] = Array(8).fill("");
  const free = () => rank.flatMap((p, i) => (p === "" ? [i] : []));

  let n = id;
  rank[[1, 3, 5, 7][n % 4]!] = "b"; // light-squared bishop
  n = Math.floor(n / 4);
  rank[[0, 2, 4, 6][n % 4]!] = "b"; // dark-squared bishop
  n = Math.floor(n / 4);
  rank[free()[n % 6]!] = "q";
  n = Math.floor(n / 6);

  const [a, b] = KNIGHT_SLOTS[n]!;
  const slots = free();
  rank[slots[a]!] = "n";
  rank[slots[b]!] = "n";

  const [r1, k, r2] = free(); // what's left is always rook, king, rook
  rank[r1!] = "r";
  rank[k!] = "k";
  rank[r2!] = "r";

  const back = rank.join("");
  // With exactly two rooks on either side of the king, KQkq is unambiguous.
  return `${back}/pppppppp/8/8/8/8/PPPPPPPP/${back.toUpperCase()} w KQkq - 0 1`;
}

export function randomChess960Fen(rnd: () => number = Math.random): string {
  return chess960Fen(Math.floor(rnd() * 960));
}

export function startFenFor(variant: Variant): string {
  return variant === "chess960" ? randomChess960Fen() : START_FEN;
}