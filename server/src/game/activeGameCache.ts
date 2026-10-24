import type { GameState } from "@lilchess/shared";

// One Node process owns this cache. SQLite remains the durable source of truth and every move
// still commits its move row and game metadata in the same transaction.
const MAX_ACTIVE_LIVE_GAMES = 512;

interface ActiveGameEntry {
  state: GameState;
  whiteId: number;
  blackId: number;
  fen: string;
  positionKeys: string[];
}

const entries = new Map<string, ActiveGameEntry>();
let hits = 0;
let misses = 0;
let evictions = 0;

function isCacheable(state: GameState): boolean {
  return state.clock.mode === "live" && state.status === "started" && state.ply === state.moves.length;
}

function cloneState(state: GameState): GameState {
  return { ...state, clock: { ...state.clock }, moves: [...state.moves] };
}

function sameMoves(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((move, index) => move === right[index]);
}

function touch(gameId: string, entry: ActiveGameEntry): void {
  entries.delete(gameId);
  entries.set(gameId, entry);
}

function evictOverflow(): void {
  while (entries.size > MAX_ACTIVE_LIVE_GAMES) {
    const oldest = entries.keys().next().value as string | undefined;
    if (oldest === undefined) return;
    entries.delete(oldest);
    evictions++;
  }
}

export function getCachedActiveGame(gameId: string): ActiveGameEntry | undefined {
  const entry = entries.get(gameId);
  if (!entry) {
    misses++;
    return undefined;
  }
  hits++;
  touch(gameId, entry);
  return {
    ...entry,
    state: cloneState(entry.state),
    positionKeys: [...entry.positionKeys],
  };
}

export function getCachedActiveGameParticipants(
  gameId: string,
): { whiteId: number; blackId: number; ply: number } | undefined {
  const entry = entries.get(gameId);
  if (!entry) {
    misses++;
    return undefined;
  }
  hits++;
  touch(gameId, entry);
  return { whiteId: entry.whiteId, blackId: entry.blackId, ply: entry.state.ply };
}

export function rememberActiveGame(
  gameId: string,
  whiteId: number,
  blackId: number,
  state: GameState,
  fen: string,
  positionKeys: string[],
): void {
  if (!isCacheable(state) || !fen || positionKeys.length === 0) {
    entries.delete(gameId);
    return;
  }

  touch(gameId, {
    state: cloneState(state),
    whiteId,
    blackId,
    fen,
    positionKeys: [...positionKeys],
  });
  evictOverflow();
}

/** Return the stored FEN only when the requested move line is exactly the cached line. */
export function getCachedFenForMoves(gameId: string, moves: string[]): string | undefined {
  const entry = entries.get(gameId);
  if (!entry || !sameMoves(entry.state.moves, moves)) return undefined;
  touch(gameId, entry);
  return entry.fen;
}

/** Refresh after a committed repository write; never publish an uncommitted state into the cache. */
export function refreshActiveGameAfterWrite(
  gameId: string,
  state: GameState,
  fen?: string,
  positionKeys?: string[],
): void {
  const entry = entries.get(gameId);
  if (!entry) return;

  if (!isCacheable(state)) {
    entries.delete(gameId);
    return;
  }

  const sameLine = entry.state.moves.length === state.moves.length &&
    entry.state.moves.at(-1) === state.moves.at(-1);
  const appendedOneMove = fen !== undefined && positionKeys && positionKeys.length > 0 &&
    state.moves.length === entry.state.moves.length + 1 &&
    state.moves.at(-2) === entry.state.moves.at(-1);

  // A normal move may append exactly one ply and supply its new position context. A takeback or
  // unexpected line replacement invalidates the entry so the next access rebuilds from SQLite.
  if (!sameLine && !appendedOneMove) {
    entries.delete(gameId);
    return;
  }

  entry.state = cloneState(state);
  if (fen !== undefined && positionKeys && positionKeys.length > 0) {
    entry.fen = fen;
    entry.positionKeys = [...positionKeys];
  }
  touch(gameId, entry);
}

export function clearActiveGameCache(): void {
  entries.clear();
  hits = 0;
  misses = 0;
  evictions = 0;
}

export function getActiveGameCacheStats(): { size: number; hits: number; misses: number; evictions: number } {
  return { size: entries.size, hits, misses, evictions };
}
