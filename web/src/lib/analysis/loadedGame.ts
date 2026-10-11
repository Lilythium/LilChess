import type { Variant } from "@lilchess/shared";

/** A game on the analysis board, whether it came from the server or was pasted in. */
export interface LoadedGame {
  variant: Variant;
  initialFen: string;
  moves: string[]; // UCI, in the order played
  white: string | null;
  black: string | null;
  result: string | null;
  termination: string | null;
}

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Identifies a game for the local analysis cache. Stored games are keyed by id (finished
 * games never change); pasted games by a hash of their content, so pasting the same PGN
 * twice finds the earlier result.
 */
export function gameCacheKey(id: string | undefined, game: LoadedGame): string {
  return id
    ? `game:${id}:${game.moves.length}`
    : `paste:${game.variant}:${fnv1a(`${game.initialFen} ${game.moves.join(" ")}`)}`;
}
