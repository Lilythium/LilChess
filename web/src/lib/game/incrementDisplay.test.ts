import { describe, expect, it } from "vitest";
import { createGame, type GameEvent, type GameState } from "@lilchess/shared";
import { applyGameEvent } from "./applyEvent.js";
import { remainingMs } from "./clock";

describe("increment as the client shows it", () => {
  it("shows the incremented time for the side that just moved", () => {
    const base = createGame({ clock: { mode: "live", initialMs: 300_000, incrementMs: 3_000 }, now: 0 });
    const game: GameState = {
      ...base, moves: ["e2e4", "e7e5"], ply: 2, turn: "white", deadlineAt: 400_000,
    };
    const view = { game, sanByPly: {} as Record<number, string> };

    // white's second move: 5s used, +3s increment => 298_000
    const event: GameEvent = {
      type: "move", gameId: "g1", ply: 3, uci: "g1f3", san: "Nf3", turn: "black",
      whiteMs: 298_000, blackMs: 300_000, deadlineAt: 598_000,
    };
    expect(applyGameEvent(view, event)).toBe("applied");

    expect(remainingMs(view.game, "white", 500_000)).toBe(298_000); // waiting side: stored value
    expect(remainingMs(view.game, "black", 500_000)).toBe(98_000); // side on move: derived from deadline
  });
});