import type { Position } from "chessops/chess";
import { parseUci } from "chessops/util";
import { fenOf, positionFromFen } from "./position.js";
import type { GameState } from "./types.js";

// A checkpoint is stored every this many plies so replaying a move never costs more than
// this many plies of work, however long the game has run.
export const SNAPSHOT_INTERVAL = 50;

// A saved position partway through a game. `keys` holds the repetition keys of the stretch of
// positions that can still recur (everything since the last capture or pawn move), oldest first,
// ending with the key of `fen` itself.
export interface ReplaySeed {
  ply: number;
  fen: string;
  keys: string[];
}

export type ReplayResult =
  | { ok: true; position: Position; positionKeys: string[] }
  | { ok: false; error: string };

// The repetition rule only cares about piece placement (and Crazyhouse pockets, which FEN writes into the
// placement field), side to move, castling rights, and en passant availability — not the halfmove or
// fullmove counters. Three-check also keys on the remaining checks, since the same board with a different
// check count is a different position.
export function positionKey(pos: Position): string {
  return keyFromFen(fenOf(pos), pos);
}

// Same key, for callers that already hold the FEN and would otherwise build it twice.
export function keyFromFen(fen: string, pos: Position): string {
  const base = fen.split(" ").slice(0, 4).join(" ");
  return pos.remainingChecks ? `${base} ${pos.remainingChecks.white}+${pos.remainingChecks.black}` : base;
}

// Builds the checkpoint for the position just reached. `allKeys` must end with that position's key.
// A capture or pawn move resets the halfmove clock and changes the placement for good, so nothing
// before the last `halfmoves` plies can ever repeat and those keys are dropped.
export function makeSeed(fen: string, halfmoves: number, ply: number, allKeys: string[]): ReplaySeed {
  const keep = Math.min(halfmoves + 1, allKeys.length);
  return { ply, fen, keys: allKeys.slice(allKeys.length - keep) };
}

function replayMoves(position: Position, positionKeys: string[], moves: string[]): ReplayResult {
  for (const uci of moves) {
    const move = parseUci(uci);
    if (!move) return { ok: false, error: `unparseable_move:${uci}` };
    if (!position.isLegal(move)) {
      return { ok: false, error: `illegal_move_in_history:${uci}` };
    }
    position.play(move);
    positionKeys.push(positionKey(position));
  }
  return { ok: true, position, positionKeys };
}

function replayFromSeed(game: GameState, seed: ReplaySeed): ReplayResult | null {
  if (seed.ply < 1 || seed.ply > game.moves.length || seed.keys.length === 0) return null;
  let position: Position;
  try {
    position = positionFromFen(seed.fen, game.variant);
  } catch {
    return null;
  }
  // A checkpoint whose keys don't end at its own position is damaged; don't trust it.
  if (seed.keys[seed.keys.length - 1] !== positionKey(position)) return null;
  const replayed = replayMoves(position, [...seed.keys], game.moves.slice(seed.ply));
  return replayed.ok ? replayed : null;
}

// Rebuilds the chessops position. Pure: no I/O, never mutates the GameState it's given.
//
// Without a seed it replays every move from initialFen and returns the position key after every ply
// (index 0 is the starting position). With a seed it starts from the checkpoint and replays only the
// moves after it, and positionKeys then covers just the stretch that can still repeat. A seed that
// is unusable in any way is ignored and the full replay runs, so a bad checkpoint costs time, never
// correctness.
export function replay(game: GameState, seed?: ReplaySeed): ReplayResult {
  if (seed) {
    const seeded = replayFromSeed(game, seed);
    if (seeded) return seeded;
  }

  let position: Position;
  try {
    position = positionFromFen(game.initialFen, game.variant);
  } catch {
    return { ok: false, error: "invalid_initial_fen" };
  }
  return replayMoves(position, [positionKey(position)], game.moves);
}
