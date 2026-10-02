import { describe, expect, it } from "vitest";
import { createGame, type GameState } from "@lilchess/shared";
import { boardMode } from "./boardMode";

const live = createGame({ clock: { mode: "live", initialMs: 60_000, incrementMs: 0 }, now: 0 });
const corr = createGame({ clock: { mode: "correspondence", daysPerMove: 3 }, now: 0 });
const blackToMove = (g: GameState): GameState => ({ ...g, ply: 1, turn: "black" });

describe("boardMode", () => {
  it("lets the player to move move, without premoves queued", () => {
    expect(boardMode(live, "white", true)).toEqual({
      movableColor: "white", movesEnabled: true, premovesEnabled: true,
    });
  });

  it("lets the waiting player premove in live games", () => {
    expect(boardMode(blackToMove(live), "white", true)).toEqual({
      movableColor: "white", movesEnabled: false, premovesEnabled: true,
    });
  });

  it("does not offer premoves in correspondence games", () => {
    expect(boardMode(blackToMove(corr), "white", true).premovesEnabled).toBe(false);
  });

  it("is read-only for spectators, finished games and history browsing", () => {
    const off = { movableColor: undefined, movesEnabled: false, premovesEnabled: false };
    expect(boardMode(live, null, true)).toEqual(off);
    expect(boardMode({ ...live, status: "finished" }, "white", true)).toEqual(off);
    expect(boardMode(live, "white", false)).toEqual(off);
  });
});