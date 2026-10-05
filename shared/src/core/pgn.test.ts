import { describe, expect, it } from "vitest";
import { buildPgn } from "./pgn.js";
import { createGame } from "./createGame.js";
import type { GameState } from "./types.js";

const LIVE = { mode: "live" as const, initialMs: 300_000, incrementMs: 3_000 };
const DATE = Date.UTC(2026, 9, 2); // 2026.10.02
const SCHOLARS = ["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6", "Qxf7#"];

const base = (): GameState => createGame({ clock: LIVE, now: 0 });
const opts = (game: GameState, sans = SCHOLARS) => ({
  game, sans, white: "alice", black: "bob", createdAt: DATE,
});

describe("buildPgn", () => {
  it("writes headers and numbered movetext for a finished game", () => {
    const game: GameState = { ...base(), status: "finished", result: "1-0", termination: "checkmate" };
    const pgn = buildPgn(opts(game));

    expect(pgn.startsWith('[Event "LilChess live game"]\n')).toBe(true);
    expect(pgn).toContain('[Date "2026.10.02"]');
    expect(pgn).toContain('[White "alice"]');
    expect(pgn).toContain('[Black "bob"]');
    expect(pgn).toContain('[Result "1-0"]');
    expect(pgn).toContain('[TimeControl "300+3"]');
    expect(pgn).toContain('[Termination "Normal"]');
    expect(pgn).toContain("1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# 1-0\n");
  });

  it("marks an unfinished game with * and Unterminated", () => {
    const pgn = buildPgn(opts(base(), ["e4", "e5"]));
    expect(pgn).toContain('[Result "*"]');
    expect(pgn).toContain('[Termination "Unterminated"]');
    expect(pgn).toContain("1. e4 e5 *\n");
  });

  it("describes timeouts and aborts", () => {
    const timeout: GameState = { ...base(), status: "finished", result: "0-1", termination: "timeout" };
    expect(buildPgn(opts(timeout))).toContain('[Termination "Time forfeit"]');

    const aborted: GameState = { ...base(), status: "aborted", termination: "abort" };
    const pgn = buildPgn(opts(aborted, ["e4"]));
    expect(pgn).toContain('[Termination "Abandoned"]');
    expect(pgn).toContain('[Result "*"]');
  });

  it("uses PGN's moves-per-seconds form for correspondence", () => {
    const game = createGame({ clock: { mode: "correspondence", daysPerMove: 3 }, now: 0 });
    expect(buildPgn(opts(game))).toContain('[TimeControl "1/259200"]');
  });

  it("escapes quotes and backslashes in header values", () => {
    const pgn = buildPgn({ ...opts(base()), white: 'a"b\\c' });
    expect(pgn).toContain('[White "a\\"b\\\\c"]');
  });

  it("adds SetUp and FEN for a custom start position", () => {
    const game = { ...base(), initialFen: "k7/2Q5/8/8/8/8/8/7K w - - 0 1" };
    const pgn = buildPgn(opts(game, ["Qb6"]));
    expect(pgn).toContain('[SetUp "1"]');
    expect(pgn).toContain('[FEN "k7/2Q5/8/8/8/8/8/7K w - - 0 1"]');
  });

  it("wraps long movetext at 80 columns", () => {
    const sans = Array.from({ length: 80 }, (_, i) => (i % 2 === 0 ? "Nf3" : "Nf6"));
    const movetext = buildPgn(opts(base(), sans)).split("\n\n")[1]!;
    for (const line of movetext.trimEnd().split("\n")) expect(line.length).toBeLessThanOrEqual(80);
  });

  it("tags Chess960 games and always includes the start position", () => {
    const game = createGame({ clock: LIVE, now: 0, variant: "chess960", initialFen: "bbqnnrkr/pppppppp/8/8/8/8/PPPPPPPP/BBQNNRKR w KQkq - 0 1" });
    const pgn = buildPgn(opts(game, ["Nd3"]));
    expect(pgn).toContain('[Variant "Chess960"]');
    expect(pgn).toContain('[SetUp "1"]');
    expect(pgn).toContain('[FEN "bbqnnrkr/pppppppp/8/8/8/8/PPPPPPPP/BBQNNRKR w KQkq - 0 1"]');
  });
});