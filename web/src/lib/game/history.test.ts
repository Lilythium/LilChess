import { describe, expect, it } from "vitest";
import { createGame, type GameState } from "@lilchess/shared";
import { gameAtPly, selectPly, stepView } from "./history";

describe("stepView", () => {
  it("steps back from live", () => {
    expect(stepView(null, 10, "prev")).toBe(9);
  });
  it("stops at the start", () => {
    expect(stepView(0, 10, "prev")).toBe(0);
    expect(stepView(3, 10, "first")).toBe(0);
  });
  it("returns to live (null) when stepping onto the last ply", () => {
    expect(stepView(9, 10, "next")).toBeNull();
    expect(stepView(4, 10, "last")).toBeNull();
    expect(stepView(null, 10, "next")).toBeNull();
  });
  it("stays live on an empty game", () => {
    expect(stepView(null, 0, "prev")).toBeNull();
    expect(stepView(null, 0, "first")).toBeNull();
  });
});

describe("selectPly", () => {
  it("selecting the latest move means live", () => {
    expect(selectPly(10, 10)).toBeNull();
    expect(selectPly(4, 10)).toBe(4);
  });
});

describe("gameAtPly", () => {
  const base: GameState = {
    ...createGame({ clock: { mode: "live", initialMs: 60_000, incrementMs: 0 }, now: 0 }),
    moves: ["e2e4", "e7e5", "g1f3"],
    ply: 3,
    turn: "black",
  };

  it("returns the same object when live or past the end", () => {
    expect(gameAtPly(base, null)).toBe(base);
    expect(gameAtPly(base, 3)).toBe(base);
  });

  it("truncates moves and fixes ply and turn", () => {
    const g2 = gameAtPly(base, 2);
    expect(g2.moves).toEqual(["e2e4", "e7e5"]);
    expect(g2.ply).toBe(2);
    expect(g2.turn).toBe("white");
    expect(gameAtPly(base, 1).turn).toBe("black");
    expect(gameAtPly(base, 0).moves).toEqual([]);
  });
});