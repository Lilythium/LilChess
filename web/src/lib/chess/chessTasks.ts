import { PositionTimeline, type TimelineSnapshot, type Variant } from "@lilchess/shared";
import { parseAnalysisInput, type ParsedInput } from "../analysis/importText";

// The chess work that is big enough to be worth moving off the main thread: parsing pasted PGNs and building every
// position of a whole game. These are plain functions of plain data. The Web Worker runs them, and so does the
// fallback when no worker can be started, so there is exactly one implementation of each.
//
// Deliberately NOT here: legal moves for the position on the board. That costs microseconds, chessops positions
// cannot be sent between threads (they are class instances), and a round trip would add more latency than the work.

export type ChessRequest =
  | { op: "parseInput"; text: string }
  | { op: "timeline"; initialFen: string; variant: Variant; moves: string[] };

export interface ParseInputResult {
  parsed: ParsedInput;
  /** Every position of the parsed game, so the page need not replay it. Null when nothing parsed or a move is illegal. */
  timeline: TimelineSnapshot | null;
}

export type WorkerRequest = { id: number; request: ChessRequest };
export type WorkerResponse = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: string };

/** Every position of a game as plain data, or null if the start position is invalid or a move is illegal. */
export function buildTimeline(initialFen: string, variant: Variant, moves: string[]): TimelineSnapshot | null {
  try {
    const timeline = new PositionTimeline(initialFen, variant);
    return timeline.sync(moves) ? timeline.snapshot() : null;
  } catch {
    return null;
  }
}

export function runChessTask(request: { op: "parseInput"; text: string }): ParseInputResult;
export function runChessTask(request: { op: "timeline"; initialFen: string; variant: Variant; moves: string[] }): TimelineSnapshot | null;
export function runChessTask(request: ChessRequest): ParseInputResult | TimelineSnapshot | null;
export function runChessTask(request: ChessRequest): ParseInputResult | TimelineSnapshot | null {
  switch (request.op) {
    case "parseInput": {
      const parsed = parseAnalysisInput(request.text);
      const timeline = parsed.ok ? buildTimeline(parsed.game.initialFen, parsed.game.variant, parsed.game.moves) : null;
      return { parsed, timeline };
    }
    case "timeline":
      return buildTimeline(request.initialFen, request.variant, request.moves);
  }
}
