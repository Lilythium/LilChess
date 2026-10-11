import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import { makeSquare, parseUci, squareFile } from "chessops/util";

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

  constructor(readonly initialFen: string) {
    const setup = parseFen(initialFen);
    const pos = setup.isOk ? Chess.fromSetup(setup.value) : undefined;
    if (!pos || pos.isErr) throw new Error("invalid_initial_fen");
    this.fens = [makeFen(pos.value.toSetup())];
  }

  get length(): number {
    return this.moves.length;
  }

  /** Brings the timeline in line with `moves`. Returns false if a move is illegal; the timeline then stops before it. */
  sync(moves: string[]): boolean {
    let keep = 0;
    while (keep < this.moves.length && keep < moves.length && this.moves[keep] === moves[keep]) keep++;
    this.moves.length = keep;
    this.sans.length = keep;
    this.fens.length = keep + 1;
    this.squares.length = keep + 1;

    const pos = Chess.fromSetup(parseFen(this.fens[keep]!).unwrap()).unwrap();
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
      this.fens.push(makeFen(pos.toSetup()));

      if (!isNormal) this.squares.push([makeSquare(move.to), makeSquare(move.to)]);
      else if (castled) this.squares.push([makeSquare(move.from), makeSquare(pos.board.kingOf(mover)!)]);
      else this.squares.push([makeSquare(move.from), makeSquare(move.to)]);
    }
    return true;
  }
}
