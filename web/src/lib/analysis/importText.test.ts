import { describe, expect, it } from "vitest";
import { PositionTimeline, START_FEN } from "@lilchess/shared";
import { MAX_PLIES, parseAnalysisInput } from "./importText";

const ok = (text: string) => {
  const r = parseAnalysisInput(text);
  if (!r.ok) throw new Error(r.error);
  return r;
};
const err = (text: string) => {
  const r = parseAnalysisInput(text);
  if (r.ok) throw new Error("expected an error");
  return r.error;
};

describe("FEN input", () => {
  it("loads a position with no moves", () => {
    const r = ok("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1");
    expect(r.kind).toBe("fen");
    expect(r.game.moves).toEqual([]);
    expect(r.game.variant).toBe("standard");
    expect(r.game.initialFen.startsWith("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b")).toBe(true);
  });
  it("detects a Chess960 start from its castling layout", () => {
    expect(ok("nrkbbnqr/pppppppp/8/8/8/8/PPPPPPPP/NRKBBNQR w KQkq - 0 1").game.variant).toBe("chess960");
    expect(ok(START_FEN).game.variant).toBe("standard");
  });
  it("rejects garbage and illegal positions", () => {
    expect(err("not/a/fen at all")).toMatch(/valid FEN/);
    expect(err("8/8/8/8/8/8/8/8 w - - 0 1")).toMatch(/isn't legal/);
  });
});

describe("PGN input", () => {
  const scholars = `[Event "Casual"]
[White "Alice"]
[Black "Bob"]
[Result "1-0"]
[Termination "Normal"]

1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6?? 4. Qxf7# 1-0`;

  it("reads moves, names and result", () => {
    const r = ok(scholars);
    expect(r.kind).toBe("pgn");
    expect(r.game).toMatchObject({
      variant: "standard", white: "Alice", black: "Bob", result: "1-0", termination: "normal",
      moves: ["e2e4", "e7e5", "f1c4", "b8c6", "d1h5", "g8f6", "h5f7"],
    });
  });
  it("produces moves the shared timeline accepts, castling included", () => {
    const r = ok("1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O Nf6 5. d3 O-O");
    const tl = new PositionTimeline(r.game.initialFen);
    expect(tl.sync(r.game.moves)).toBe(true);
    expect(tl.sans.filter((s) => s === "O-O")).toHaveLength(2);
  });
  it("works without headers and ignores comments and variations", () => {
    const r = ok("1. d4 {a comment} d5 (1... Nf6 2. c4) 2. c4 *");
    expect(r.game.moves).toEqual(["d2d4", "d7d5", "c2c4"]);
    expect(r.game.white).toBeNull();
  });
  it("uses the first game and reports how many were found", () => {
    const r = ok(`[White "A"]\n\n1. e4 *\n\n[White "B"]\n\n1. d4 *`);
    expect(r.gamesFound).toBe(2);
    expect(r.game.white).toBe("A");
  });
  it("honours the FEN and Variant headers (Chess960)", () => {
    const r = ok(`[Variant "Chess960"]
[FEN "nrkbbnqr/pppppppp/8/8/8/8/PPPPPPPP/NRKBBNQR w KQkq - 0 1"]
[SetUp "1"]

1. e4 e5 *`);
    expect(r.game.variant).toBe("chess960");
    expect(r.game.initialFen.startsWith("nrkbbnqr/")).toBe(true);
    expect(r.game.moves).toEqual(["e2e4", "e7e5"]);
  });
  it("drops placeholder names and unknown results", () => {
    const r = ok(`[White "?"]\n[Black "Bob"]\n[Result "*"]\n\n1. e4 *`);
    expect(r.game).toMatchObject({ white: null, black: "Bob", result: null });
  });
  it("reports the move where it goes wrong", () => {
    expect(err("1. e4 e5 2. Ke4 *")).toMatch(/Illegal or unreadable move "Ke4" at move 2/);
  });
  it("rejects unsupported variants", () => {
    expect(err(`[Variant "Crazyhouse"]\n\n1. e4 *`)).toMatch(/Only standard chess and Chess960/);
  });
  it("accepts a PGN with only a FEN header as a position", () => {
    const r = ok(`[FEN "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"]\n[SetUp "1"]\n\n*`);
    expect(r.game.moves).toEqual([]);
    expect(r.game.initialFen.startsWith("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b")).toBe(true);
  });
  it("rejects a bad FEN header", () => {
    expect(err(`[FEN "garbage"]\n[SetUp "1"]\n\n1. e4 *`)).toMatch(/starting position/);
  });
  it("rejects text that is not a game", () => {
    expect(err("hello there\nthis is not chess")).toMatch(/No moves found/);
    expect(err("1-0")).toMatch(/No moves found/);
  });
});

describe("limits", () => {
  it("rejects empty and oversized input", () => {
    expect(err("   ")).toMatch(/Paste a PGN/);
    expect(err("x".repeat(200_001))).toMatch(/too long/);
  });
  it("caps the length of a game", () => {
    const shuffle = Array.from({ length: MAX_PLIES / 4 + 5 }, (_, i) => `${i * 2 + 1}. Nf3 Nf6 ${i * 2 + 2}. Ng1 Ng8`).join(" ");
    expect(err(shuffle)).toMatch(/longer than/);
  });
});
