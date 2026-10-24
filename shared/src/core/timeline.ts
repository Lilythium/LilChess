import { makeSan } from "chessops/san";
import { makeSquare, parseUci, squareFile } from "chessops/util";
import { fenOf, positionFromFen } from "./position.js";
import type { Variant } from "./types.js";

/** A timeline as plain data: arrays of strings, so it survives structured clone (postMessage) and JSON. */
export interface TimelineSnapshot {
  moves: string[];
  fens: string[];
  sans: string[];
  squares: ([string, string] | null)[];
}

/**
 * Every position of a game, built once and extended incrementally.
 *
 *   fens[i]      position after i plies (fens[0] is the start)
 *   sans[i - 1]  SAN of ply i
 *   squares[i]   [from, to] of ply i for highlighting (castling = king start → king end)
 *
 * Navigating a game is then an array lookup instead of a replay from move 1.
 * `sync` replays only what changed: a new move is one step, a takeback truncates.
 */
export class PositionTimeline {
  readonly moves: string[] = [];
  readonly fens: string[];
  readonly sans: string[] = [];
  readonly squares: ([string, string] | null)[] = [null];

  constructor(readonly initialFen: string, readonly variant: Variant = "standard") {
    this.fens = [fenOf(positionFromFen(initialFen, variant))]; // throws "invalid_initial_fen"
  }

  get length(): number {
    return this.moves.length;
  }

  /** Copies of the arrays, safe to hand to another thread or keep while this timeline keeps changing. */
  snapshot(): TimelineSnapshot {
    return {
      moves: [...this.moves],
      fens: [...this.fens],
      sans: [...this.sans],
      squares: this.squares.map((pair) => (pair ? [pair[0], pair[1]] : null)),
    };
  }

  /**
   * Rebuilds a timeline from a snapshot made elsewhere (a Web Worker) without replaying a move. The snapshot is
   * copied, and later `sync` calls extend or truncate this timeline as usual. Throws on inconsistent lengths.
   */
  static restore(initialFen: string, variant: Variant, data: TimelineSnapshot): PositionTimeline {
    const n = data.moves.length;
    if (data.fens.length !== n + 1 || data.sans.length !== n || data.squares.length !== n + 1) {
      throw new Error("invalid_timeline_snapshot");
    }
    const tl = new PositionTimeline(initialFen, variant);
    tl.moves.push(...data.moves);
    tl.fens.length = 0;
    tl.fens.push(...data.fens);
    tl.sans.push(...data.sans);
    tl.squares.length = 0;
    for (const pair of data.squares) tl.squares.push(pair ? [pair[0], pair[1]] : null);
    return tl;
  }

  /** Brings the timeline in line with `moves`. Returns false if a move is illegal; the timeline then stops before it. */
  sync(moves: string[]): boolean {
    let keep = 0;
    while (keep < this.moves.length && keep < moves.length && this.moves[keep] === moves[keep]) keep++;
    this.moves.length = keep;
    this.sans.length = keep;
    this.fens.length = keep + 1;
    this.squares.length = keep + 1;

    const pos = positionFromFen(this.fens[keep]!, this.variant);
    for (let i = keep; i < moves.length; i++) {
      const uci = moves[i]!;
      const move = parseUci(uci);
      if (!move || !pos.isLegal(move)) return false;

      const mover = pos.turn;
      const isNormal = "from" in move;
      const castled =
        isNormal &&
        pos.board.king.has(move.from) &&
        (Math.abs(squareFile(move.to) - squareFile(move.from)) > 1 || pos.board[mover].has(move.to));

      this.sans.push(makeSan(pos, move));
      pos.play(move);
      this.moves.push(uci);
      this.fens.push(fenOf(pos));

      if (!isNormal) this.squares.push([makeSquare(move.to), makeSquare(move.to)]);
      else if (castled) this.squares.push([makeSquare(move.from), makeSquare(pos.board.kingOf(mover)!)]);
      else this.squares.push([makeSquare(move.from), makeSquare(move.to)]);
    }
    return true;
  }
}
