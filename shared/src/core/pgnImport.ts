import { makeFen } from "chessops/fen";
import { parsePgn, startingPosition } from "chessops/pgn";
import type { Game, PgnNodeData } from "chessops/pgn";
import { makeSan, parseSan } from "chessops/san";
import type { Setup } from "chessops/setup";
import { makeUci, squareFile, squareRank } from "chessops/util";
import type { Variant } from "./types.js";

export const IMPORT_MAX_CHARS = 500_000;
export const IMPORT_MAX_GAMES = 50;
export const IMPORT_MAX_PLIES = 1000;

export type ImportedResult = "1-0" | "0-1" | "1/2-1/2" | "*";

/** One game from a PGN file, validated move by move. Nothing in here refers to an account. */
export interface ParsedPgnGame {
  index: number; // 1-based position in the file
  white: string;
  black: string;
  whiteElo: number | null;
  blackElo: number | null;
  event: string | null;
  site: string | null;
  date: string | null; // PGN style, e.g. "2026.10.10" (parts may be "??")
  timeControl: string | null; // the PGN tag as written, e.g. "60+0"
  termination: string | null; // the PGN tag as written, e.g. "Time forfeit"
  variant: Variant;
  result: ImportedResult;
  initialFen: string;
  finalFen: string;
  moves: string[]; // UCI
  sans: string[]; // canonical SAN, one per move
}

export interface PgnParseFailure {
  index: number; // 1-based game number, 0 for problems with the file as a whole
  label: string; // "Game 3" or "Game 3 (Alice vs Bob)"
  message: string;
}

export interface PgnParseOutcome {
  games: ParsedPgnGame[];
  failures: PgnParseFailure[];
}

class GameProblem extends Error {}

const STANDARD_TAGS = new Set(["", "standard", "chess", "from position", "normal"]);
const CHESS960_TAGS = new Set(["chess960", "chess 960", "fischerandom", "fischer random", "freestyle"]);
const RESULTS = new Set(["1-0", "0-1", "1/2-1/2"]);

/** Castling rights that only exist in Chess960: a king off the e-file or a rook off the a/h files. */
export function needsChess960(setup: Setup): boolean {
  for (const square of setup.castlingRights) {
    const color = squareRank(square) === 0 ? "white" : "black";
    const king = setup.board.kingOf(color);
    if (king === undefined || squareFile(king) !== 4 || squareFile(square) % 7 !== 0) return true;
  }
  return false;
}

/** Trims, strips control characters and caps the length. "?" and "-" mean "unknown" in PGN. */
function clean(value: string | undefined, max: number): string | null {
  if (value === undefined) return null;
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  return text === "" || text === "?" || text === "-" ? null : text;
}

function parseElo(value: string | undefined): number | null {
  const text = value?.trim() ?? "";
  return /^\d{1,4}$/.test(text) ? Number(text) : null;
}

function parseDate(headers: Map<string, string>): string | null {
  for (const tag of ["Date", "UTCDate"]) {
    const value = headers.get(tag)?.trim() ?? "";
    if (/^\d{4}\.(\d{2}|\?\?)\.(\d{2}|\?\?)$/.test(value)) return value;
  }
  return null;
}

function parseTimeControl(value: string | undefined): string | null {
  const text = value?.trim() ?? "";
  return /^[0-9+/*?-]{1,24}$/.test(text) && text !== "?" && text !== "-" ? text : null;
}

function convert(game: Game<PgnNodeData>, index: number): ParsedPgnGame {
  const headers = game.headers;

  const variantTag = (headers.get("Variant") ?? "").trim().toLowerCase();
  let chess960 = CHESS960_TAGS.has(variantTag);
  if (!chess960 && !STANDARD_TAGS.has(variantTag)) {
    const shown = clean(headers.get("Variant"), 30) ?? "unknown";
    throw new GameProblem(`Unsupported variant "${shown}" (only standard chess and Chess960 are supported).`);
  }

  const start = startingPosition(headers);
  if (start.isErr) throw new GameProblem("The starting position (FEN tag) isn't valid.");
  const position = start.value;
  const initialSetup = position.toSetup();
  const initialFen = makeFen(initialSetup);
  // A position set up with a plain FEN stays standard unless its castling rights only make sense in 960.
  if (!chess960 && needsChess960(initialSetup)) chess960 = true;

  const moves: string[] = [];
  const sans: string[] = [];
  for (const node of game.moves.mainline()) {
    const moveNumber = Math.floor(moves.length / 2) + 1;
    if (moves.length >= IMPORT_MAX_PLIES) {
      throw new GameProblem(`Games longer than ${IMPORT_MAX_PLIES} plies can't be imported.`);
    }
    const move = parseSan(position, node.san);
    if (!move) {
      const shown = clean(node.san, 12) ?? "?";
      throw new GameProblem(`Illegal or unreadable move "${shown}" at move ${moveNumber}.`);
    }
    sans.push(makeSan(position, move)); // canonical, with the check / mate marks
    moves.push(makeUci(move));
    position.play(move);
  }

  // chessops fills in default tags and skips words it can't read, so garbage parses as an empty game.
  // A game with no moves only counts when it names a start position.
  if (moves.length === 0 && !headers.has("FEN")) throw new GameProblem("No moves found.");

  const tagged = (headers.get("Result") ?? "*").trim();
  let result: ImportedResult = RESULTS.has(tagged) ? (tagged as ImportedResult) : "*";
  if (result === "*") {
    // No (usable) result tag: still call a finished position what it is.
    const outcome = position.outcome();
    if (outcome) result = outcome.winner === "white" ? "1-0" : outcome.winner === "black" ? "0-1" : "1/2-1/2";
  }

  return {
    index,
    white: clean(headers.get("White"), 64) ?? "Unknown",
    black: clean(headers.get("Black"), 64) ?? "Unknown",
    whiteElo: parseElo(headers.get("WhiteElo")),
    blackElo: parseElo(headers.get("BlackElo")),
    event: clean(headers.get("Event"), 120),
    site: clean(headers.get("Site"), 120),
    date: parseDate(headers),
    timeControl: parseTimeControl(headers.get("TimeControl")),
    termination: clean(headers.get("Termination"), 40),
    variant: chess960 ? "chess960" : "standard",
    result,
    initialFen,
    finalFen: makeFen(position.toSetup()),
    moves,
    sans,
  };
}

/**
 * Reads every game in a PGN file. A bad game is reported in `failures` and the rest still come back,
 * so one broken game never throws away a whole file. Only standard chess and Chess960 are accepted,
 * like the rest of the app.
 */
export function parsePgnGames(text: string): PgnParseOutcome {
  const input = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  const wholeFile = (message: string): PgnParseOutcome => ({
    games: [],
    failures: [{ index: 0, label: "File", message }],
  });
  if (!input) return wholeFile("The file is empty.");
  if (input.length > IMPORT_MAX_CHARS) return wholeFile("That file is too large to import.");

  let parsed: Game<PgnNodeData>[];
  try {
    parsed = parsePgn(input);
  } catch {
    return wholeFile("This doesn't look like a PGN file.");
  }

  const outcome: PgnParseOutcome = { games: [], failures: [] };
  parsed.slice(0, IMPORT_MAX_GAMES).forEach((game, i) => {
    const index = i + 1;
    try {
      outcome.games.push(convert(game, index));
    } catch (error) {
      if (!(error instanceof GameProblem)) throw error;
      const white = clean(game.headers.get("White"), 40);
      const black = clean(game.headers.get("Black"), 40);
      outcome.failures.push({
        index,
        label: white && black ? `Game ${index} (${white} vs ${black})` : `Game ${index}`,
        message: error.message,
      });
    }
  });

  if (parsed.length > IMPORT_MAX_GAMES) {
    outcome.failures.push({
      index: 0,
      label: "File",
      message: `Only the first ${IMPORT_MAX_GAMES} games of a file are imported; ${parsed.length - IMPORT_MAX_GAMES} more were left out.`,
    });
  }
  return outcome;
}