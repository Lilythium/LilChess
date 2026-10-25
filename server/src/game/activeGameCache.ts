import type { Position } from "chessops/chess";
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
  // The live chessops position for `fen`, so a move can clone it instead of parsing the FEN again.
  // Never handed out directly: callers get a clone, because applying a move mutates a position.
  position?: Position;
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

export function getCachedActiveGame(gameId: string): Omit<ActiveGameEntry, "position"> | undefined {
  const entry = entries.get(gameId);
  if (!entry) {
    misses++;
    return undefined;
  }
  hits++;
  touch(gameId, entry);
  return {
    state: cloneState(entry.state),
    whiteId: entry.whiteId,
    blackId: entry.blackId,
    fen: entry.fen,
    positionKeys: [...entry.positionKeys],
  };
}

/** A private copy of the cached position (safe to play a move on), or undefined if none is held. */
export function getCachedPositionCopy(gameId: string): Position | undefined {
  return entries.get(gameId)?.position?.clone();
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
  position?: Position, // ownership passes to the cache; the caller must not touch it afterwards
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
    position,
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
  position?: Position, // the position after the move; ownership passes to the cache
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
    entry.position = position; // absent -> the next move falls back to parsing the FEN
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
