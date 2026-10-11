import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { parsePgn, startingPosition } from "chessops/pgn";
import { parseSan } from "chessops/san";
import { makeUci, squareFile, squareRank } from "chessops/util";
import type { Setup } from "chessops/setup";
import type { LoadedGame } from "./loadedGame";

export const MAX_INPUT_CHARS = 200_000;
export const MAX_PLIES = 1000;

export type ParsedInput =
  | { ok: true; kind: "fen" | "pgn"; game: LoadedGame; gamesFound: number }
  | { ok: false; error: string };

const RESULTS = ["1-0", "0-1", "1/2-1/2"];

/** Castling rights that only make sense in Chess960: a king off the e-file or a rook off a/h. */
function needsChess960(setup: Setup): boolean {
  for (const square of setup.castlingRights) {
    const color = squareRank(square) === 0 ? "white" : "black";
    const king = setup.board.kingOf(color);
    if (king === undefined || squareFile(king) !== 4 || squareFile(square) % 7 !== 0) return true;
  }
  return false;
}

function header(headers: Map<string, string>, name: string): string | null {
  const value = headers.get(name)?.trim();
  return value && value !== "?" && value !== "-" ? value : null;
}

/**
 * Turns pasted text into a game for the analysis board. A single line that parses as a
 * FEN becomes a position; anything else is read as PGN (the first game is used).
 * Standard chess and Chess960 are supported, like the rest of the app.
 */
export function parseAnalysisInput(text: string): ParsedInput {
  const input = text.trim();
  if (!input) return { ok: false, error: "Paste a PGN or a FEN first." };
  if (input.length > MAX_INPUT_CHARS) return { ok: false, error: "That's too long to load (limit is about 200 KB)." };

  if (!input.includes("\n") && input.includes("/") && !input.startsWith("[")) return parseFenInput(input);
  return parsePgnInput(input);
}

function parseFenInput(input: string): ParsedInput {
  const setup = parseFen(input);
  if (setup.isErr) return { ok: false, error: "That doesn't look like a valid FEN." };
  const position = Chess.fromSetup(setup.value);
  if (position.isErr) return { ok: false, error: "That position isn't legal (check the kings and the side to move)." };
  return {
    ok: true,
    kind: "fen",
    gamesFound: 1,
    game: {
      variant: needsChess960(setup.value) ? "chess960" : "standard",
      initialFen: makeFen(position.value.toSetup()),
      moves: [],
      white: null, black: null, result: null, termination: null,
    },
  };
}

function parsePgnInput(input: string): ParsedInput {
  const games = parsePgn(input);
  const first = games[0];
  if (!first) return { ok: false, error: "No PGN game found in that text." };

  const variantHeader = (header(first.headers, "Variant") ?? "standard").toLowerCase();
  const chess960 = ["chess960", "fischerandom", "fischer random", "freestyle"].includes(variantHeader);
  if (!chess960 && !["standard", "chess", "from position"].includes(variantHeader)) {
    return { ok: false, error: `Only standard chess and Chess960 are supported (this game is "${variantHeader}").` };
  }

  const start = startingPosition(first.headers);
  if (start.isErr) return { ok: false, error: "The game's starting position (FEN header) isn't valid." };
  const position = start.value;
  const initialFen = makeFen(position.toSetup());

  const moves: string[] = [];
  for (const node of first.moves.mainline()) {
    if (moves.length >= MAX_PLIES) return { ok: false, error: `That game is longer than ${MAX_PLIES} plies.` };
    const move = parseSan(position, node.san);
    if (!move) {
      const number = Math.floor(moves.length / 2) + 1;
      return { ok: false, error: `Illegal or unreadable move "${node.san}" at move ${number}.` };
    }
    moves.push(makeUci(move));
    position.play(move);
  }

  // chessops fills in default headers and skips words it can't read, so garbage parses as an
  // empty game. A game with no moves only counts when it names a start position.
  if (moves.length === 0 && !first.headers.has("FEN")) {
    return { ok: false, error: "No moves found in that text. Paste a PGN or a FEN." };
  }

  const result = header(first.headers, "Result");
  return {
    ok: true,
    kind: "pgn",
    gamesFound: games.length,
    game: {
      variant: chess960 || chess960Start(initialFen) ? "chess960" : "standard",
      initialFen,
      moves,
      white: header(first.headers, "White"),
      black: header(first.headers, "Black"),
      result: result && RESULTS.includes(result) ? result : null,
      termination: header(first.headers, "Termination")?.toLowerCase() ?? null,
    },
  };
}

/** A start position that only exists in Chess960 (checked on the initial FEN, before any moves). */
function chess960Start(fen: string): boolean {
  const setup = parseFen(fen);
  return setup.isOk && needsChess960(setup.value);
}
