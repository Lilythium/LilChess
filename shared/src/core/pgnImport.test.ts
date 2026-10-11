import { describe, expect, it } from "vitest";
import { IMPORT_MAX_GAMES, parsePgnGames } from "./pgnImport.js";
import { chess960Fen } from "./variants.js";

const SCHOLARS = `[Event "Casual"]
[White "alice"]
[Black "bob"]
[Result "1-0"]

1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0`;

describe("parsePgnGames", () => {
  it("reads a game and keeps both player names exactly as written", () => {
    const { games, failures } = parsePgnGames(SCHOLARS);
    expect(failures).toEqual([]);
    expect(games).toHaveLength(1);
    expect(games[0]).toMatchObject({
      index: 1, white: "alice", black: "bob", event: "Casual", result: "1-0", variant: "standard",
    });
    expect(games[0]!.moves).toEqual(["e2e4", "e7e5", "d1h5", "b8c6", "f1c4", "g8f6", "h5f7"]);
    expect(games[0]!.sans.at(-1)).toBe("Qxf7#");
    expect(games[0]!.finalFen).not.toBe(games[0]!.initialFen);
  });

  it("accepts annotation glyphs like !! and ??, comments, NAGs and variations", () => {
    const { games, failures } = parsePgnGames(`[White "A"]
[Black "B"]
[Result "1-0"]

1. e4!! { best by test } e5?? $14 2. Qh5!? (2. Nf3 Nc6) 2... Nc6 3. Bc4 Nf6?? 4. Qxf7# 1-0`);
    expect(failures).toEqual([]);
    expect(games[0]!.moves).toHaveLength(7); // the variation is ignored, only the main line is kept
  });

  it("rebuilds SAN itself, so missing check marks are repaired", () => {
    const { games } = parsePgnGames(`[White "A"]\n[Black "B"]\n\n1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7 1-0`);
    expect(games[0]!.sans.at(-1)).toBe("Qxf7#");
  });

  it("does not assume anyone: names that match no account are just names", () => {
    const { games } = parsePgnGames(`[White "Carlsen, Magnus"]\n[Black "Nakamura, Hikaru"]\n[WhiteElo "2830"]\n[BlackElo "oops"]\n\n1. e4 e5 *`);
    expect(games[0]).toMatchObject({ white: "Carlsen, Magnus", black: "Nakamura, Hikaru", whiteElo: 2830, blackElo: null });
  });

  it("falls back to Unknown for missing or '?' names, and cleans odd characters", () => {
    const { games } = parsePgnGames(`[White "?"]\n[Black "  Bo\tb  "]\n\n1. e4 *`);
    expect(games[0]).toMatchObject({ white: "Unknown", black: "Bo b" });
  });

  it("returns the games it can and reports the ones it can't, with their number", () => {
    const { games, failures } = parsePgnGames(`${SCHOLARS}

[White "carol"]
[Black "dave"]
[Result "*"]

1. e4 e5 2. Qh6 Nc6 *

${SCHOLARS.replace("alice", "erin")}`);
    expect(games.map((g) => g.index)).toEqual([1, 3]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ index: 2, label: "Game 2 (carol vs dave)" });
    expect(failures[0]!.message).toMatch(/Illegal or unreadable move "Qh6" at move 2/);
  });

  it("reports garbage and empty input instead of importing an empty game", () => {
    expect(parsePgnGames("hello world").failures[0]!.message).toBe("No moves found.");
    expect(parsePgnGames("   ").failures[0]).toMatchObject({ index: 0, message: "The file is empty." });
    expect(parsePgnGames("x".repeat(600_000)).failures[0]!.message).toMatch(/too large/);
  });

  it("reads an unfinished game as '*', and derives the result of a finished position when the tag is missing", () => {
    expect(parsePgnGames(`[White "A"]\n[Black "B"]\n\n1. e4 e5`).games[0]!.result).toBe("*");
    const mate = parsePgnGames(`[White "A"]\n[Black "B"]\n\n1. f3 e5 2. g4 Qh4#`).games[0]!;
    expect(mate.result).toBe("0-1");
  });

  it("trusts a result tag over the position", () => {
    expect(parsePgnGames(`[White "A"]\n[Black "B"]\n[Result "1/2-1/2"]\n\n1. e4 e5 1/2-1/2`).games[0]!.result).toBe("1/2-1/2");
  });

  it("keeps clean metadata and drops junk", () => {
    const { games } = parsePgnGames(`[Event "Rated Bullet"]
[Site "https://lichess.org/abc"]
[Date "2026.10.10"]
[White "A"]
[Black "B"]
[TimeControl "60+0"]
[Termination "Time forfeit"]
[Result "0-1"]

1. e4 e5 0-1`);
    expect(games[0]).toMatchObject({
      event: "Rated Bullet", site: "https://lichess.org/abc", date: "2026.10.10", timeControl: "60+0", termination: "Time forfeit",
    });
    const junk = parsePgnGames(`[Date "yesterday"]\n[TimeControl "<script>"]\n[White "A"]\n[Black "B"]\n\n1. e4 *`).games[0]!;
    expect(junk.date).toBeNull();
    expect(junk.timeControl).toBeNull();
  });

  describe("variants", () => {
    it("reads Chess960 games, including castling", () => {
      const fen = chess960Fen(518); // the standard array, so castling is playable
      const { games, failures } = parsePgnGames(`[Variant "Chess960"]\n[SetUp "1"]\n[FEN "${fen}"]\n[White "A"]\n[Black "B"]\n\n1. e4 e5 2. Nf3 Nf6 3. Be2 Be7 4. O-O O-O *`);
      expect(failures).toEqual([]);
      expect(games[0]!.variant).toBe("chess960");
    });

    it("detects a Chess960 start from the FEN even when the tags don't say so", () => {
      const fen = chess960Fen(0);
      const { games } = parsePgnGames(`[SetUp "1"]\n[FEN "${fen}"]\n[White "A"]\n[Black "B"]\n\n*`);
      expect(games[0]!.variant).toBe("chess960");
    });

    it("keeps an ordinary custom position standard (the old importer called it Chess960)", () => {
      const fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";
      const { games } = parsePgnGames(`[SetUp "1"]\n[FEN "${fen}"]\n[White "A"]\n[Black "B"]\n\n1... e5 *`);
      expect(games[0]!.variant).toBe("standard");
    });

    it("refuses other variants with a clear message instead of misfiling them as standard", () => {
      const { games, failures } = parsePgnGames(`[Variant "Atomic"]\n[White "A"]\n[Black "B"]\n\n1. e4 e5 *`);
      expect(games).toEqual([]);
      expect(failures[0]!.message).toBe('Unsupported variant "Atomic" (only standard chess and Chess960 are supported).');
    });

    it("rejects an invalid FEN", () => {
      const { failures } = parsePgnGames(`[SetUp "1"]\n[FEN "not a fen"]\n[White "A"]\n[Black "B"]\n\n1. e4 *`);
      expect(failures[0]!.message).toMatch(/starting position/);
    });
  });

  it("caps the number of games per file and says so", () => {
    const many = Array.from({ length: IMPORT_MAX_GAMES + 3 }, () => SCHOLARS).join("\n\n");
    const { games, failures } = parsePgnGames(many);
    expect(games).toHaveLength(IMPORT_MAX_GAMES);
    expect(failures.at(-1)!.message).toMatch(/Only the first 50 games/);
  });

  it("copes with a byte-order mark and Windows line endings", () => {
    const { games } = parsePgnGames("\uFEFF" + SCHOLARS.replace(/\n/g, "\r\n"));
    expect(games).toHaveLength(1);
  });
});