import { describe, expect, it } from "vitest";
import { classifyGame, classifyMove, summariseVerdicts, type PositionEval } from "./classify.js";
import { PositionTimeline } from "../core/timeline.js";

const ev = (cp: number, best: string | null = null): PositionEval => ({ score: { kind: "cp", cp }, best, depth: 12 });

describe("classifyMove", () => {
  it("is best when the engine's move was played", () => {
    expect(classifyMove(ev(30), ev(-200), "white", true).cls).toBe("best");
  });
  it("is best when the loss is negligible", () => {
    expect(classifyMove(ev(30), ev(28), "white", false).cls).toBe("best");
  });
  it("grades by win-chance lost, from the mover's side (White)", () => {
    expect(classifyMove(ev(0), ev(-60), "white", false).cls).toBe("good");
    expect(classifyMove(ev(0), ev(-150), "white", false).cls).toBe("inaccuracy");
    expect(classifyMove(ev(0), ev(-300), "white", false).cls).toBe("mistake");
    expect(classifyMove(ev(0), ev(-700), "white", false).cls).toBe("blunder");
  });
  it("grades from the mover's side (Black): a rising White score is bad for Black", () => {
    expect(classifyMove(ev(0), ev(700), "black", false).cls).toBe("blunder");
    expect(classifyMove(ev(0), ev(-700), "black", false).cls).toBe("best"); // Black improved
  });
  it("never reports a negative loss", () => {
    expect(classifyMove(ev(0), ev(300), "white", false).loss).toBe(0);
  });
  it("counts throwing away a forced mate as a blunder", () => {
    const before: PositionEval = { score: { kind: "mate", moves: 2 }, best: "a1a8", depth: 12 };
    expect(classifyMove(before, ev(100), "white", false).cls).toBe("blunder");
  });
});

describe("classifyGame", () => {
  const tl = new PositionTimeline("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
  tl.sync(["e2e4", "e7e5", "d1h5"]);

  it("returns undefined until both neighbouring positions are evaluated", () => {
    const evals = [ev(20, "e2e4"), ev(-20, "e7e5")];
    const out = classifyGame(tl.fens, tl.moves, evals);
    expect(out[0]?.cls).toBe("best"); // e4 matches the engine move
    expect(out[1]).toBeUndefined(); // position after ply 2 not evaluated yet
    expect(out[2]).toBeUndefined();
  });

  it("assigns the mover correctly for each ply", () => {
    // White's e4 is best, Black's e5 loses 40% for Black, White's Qh5 keeps the edge.
    const evals = [ev(20, "e2e4"), ev(-20, "g8f6"), ev(450, "d1h5"), ev(450)];
    const out = classifyGame(tl.fens, tl.moves, evals);
    expect(out.map((v) => v?.cls)).toEqual(["best", "blunder", "best"]);
  });
});

describe("summariseVerdicts", () => {
  it("counts bad moves per side by ply parity and skips unevaluated plies", () => {
    const v = (cls: "best" | "good" | "inaccuracy" | "mistake" | "blunder") => ({ cls, loss: 0 });
    const out = summariseVerdicts([v("best"), v("blunder"), v("mistake"), v("inaccuracy"), undefined, v("blunder")]);
    expect(out.white).toEqual({ inaccuracy: 0, mistake: 1, blunder: 0 });
    expect(out.black).toEqual({ inaccuracy: 1, mistake: 0, blunder: 2 });
  });
});
