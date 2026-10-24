import { describe, expect, it } from "vitest";
import { PositionTimeline, START_FEN } from "@lilchess/shared";
import { buildTimeline, runChessTask } from "./chessTasks";

const PGN = `[Event "x"]\n[White "Alice"]\n[Black "Bob"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0\n`;

describe("buildTimeline", () => {
  it("matches a timeline built on the main thread", () => {
    const moves = ["e2e4", "e7e5", "g1f3"];
    const direct = new PositionTimeline(START_FEN);
    direct.sync(moves);
    expect(buildTimeline(START_FEN, "standard", moves)).toEqual(direct.snapshot());
  });

  it("is null for an illegal move or an invalid start position, never a throw", () => {
    expect(buildTimeline(START_FEN, "standard", ["e2e4", "e2e4"])).toBeNull();
    expect(buildTimeline("nonsense", "standard", [])).toBeNull();
  });
});

describe("runChessTask", () => {
  it("parses a PGN and returns its positions with it", () => {
    const { parsed, timeline } = runChessTask({ op: "parseInput", text: PGN });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.game.moves).toEqual(["e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "a7a6"]);
    expect(timeline?.moves).toEqual(parsed.game.moves);
    expect(timeline?.sans).toEqual(["e4", "e5", "Nf3", "Nc6", "Bb5", "a6"]);
    expect(timeline?.fens).toHaveLength(7);
  });

  it("parses a FEN into a one-position timeline", () => {
    const { parsed, timeline } = runChessTask({ op: "parseInput", text: START_FEN });
    expect(parsed.ok && parsed.kind).toBe("fen");
    expect(timeline?.fens).toEqual([START_FEN]);
  });

  it("reports an error and no timeline for text that is not chess", () => {
    const { parsed, timeline } = runChessTask({ op: "parseInput", text: "hello there" });
    expect(parsed.ok).toBe(false);
    expect(timeline).toBeNull();
  });

  it("builds a timeline on request", () => {
    const snapshot = runChessTask({ op: "timeline", initialFen: START_FEN, variant: "standard", moves: ["d2d4"] });
    expect(snapshot?.sans).toEqual(["d4"]);
  });

  it("returns only plain data that survives structured clone", () => {
    const result = runChessTask({ op: "parseInput", text: PGN });
    expect(structuredClone(result)).toEqual(result);
  });
});
