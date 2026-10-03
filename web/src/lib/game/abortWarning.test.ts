import { describe, expect, it } from "vitest";
import { createGame, type GameState } from "@lilchess/shared";
import { abortWarning } from "./abortWarning";

const live = createGame({ clock: { mode: "live", initialMs: 60_000, incrementMs: 0 }, now: 0 }); // deadline 30_000
const corr = createGame({ clock: { mode: "correspondence", daysPerMove: 3 }, now: 0 });

describe("abortWarning", () => {
  it("tells the player on move to move, rounding seconds up", () => {
    const w = abortWarning(live, "white", 17_700);
    expect(w?.secondsLeft).toBe(13);
    expect(w?.text).toBe("Make a move or the game will abort in 13s");
  });

  it("tells the waiting player they're waiting", () => {
    expect(abortWarning(live, "black", 17_700)?.text).toBe(
      "Waiting for your opponent... The game will abort in 13s",
    );
  });

  it("tells spectators who must move", () => {
    expect(abortWarning(live, null, 17_700)?.text).toBe("White must move or the game will abort in 13s");
  });

  it("covers black's window after white's first move", () => {
    const g: GameState = { ...live, ply: 1, turn: "black", deadlineAt: 40_000 };
    expect(abortWarning(g, "black", 35_000)?.text).toBe("Make a move or the game will abort in 5s");
  });

  it("turns urgent at 10 seconds", () => {
    expect(abortWarning(live, "white", 19_999)?.urgent).toBe(false); // 10.001s -> 11
    expect(abortWarning(live, "white", 20_000)?.urgent).toBe(true);
  });

  it("never goes negative", () => {
    expect(abortWarning(live, "white", 31_000)?.secondsLeft).toBe(0);
  });

  it("is null once the clock is running, for correspondence, and after the game ends", () => {
    expect(abortWarning({ ...live, ply: 2 }, "white", 1_000)).toBeNull();
    expect(abortWarning(corr, "white", 1_000)).toBeNull();
    expect(abortWarning({ ...live, status: "aborted" }, "white", 1_000)).toBeNull();
    expect(abortWarning({ ...live, status: "finished" }, "white", 1_000)).toBeNull();
  });
});