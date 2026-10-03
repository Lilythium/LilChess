import { describe, expect, it } from "vitest";
import { createGame, type GameEvent } from "@lilchess/shared";
import { applyGameEvent, type EventTarget } from "./applyEvent";

const fresh = (): EventTarget => ({
  game: createGame({ clock: { mode: "live", initialMs: 60_000, incrementMs: 0 }, now: 0 }),
  sanByPly: {},
});

const move = (ply: number, uci = "e2e4", san = "e4"): GameEvent => ({
  type: "move", gameId: "g1", ply, uci, san,
  turn: ply % 2 === 0 ? "white" : "black",
  whiteMs: 60_000, blackMs: 60_000, deadlineAt: 99_000,
});

describe("applyGameEvent — moves", () => {
  it("applies the next ply", () => {
    const v = fresh();
    expect(applyGameEvent(v, move(1))).toBe("applied");
    expect(v.game?.moves).toEqual(["e2e4"]);
    expect(v.game?.ply).toBe(1);
    expect(v.game?.turn).toBe("black");
    expect(v.sanByPly[1]).toBe("e4");
  });

  it("ignores a duplicate", () => {
    const v = fresh();
    applyGameEvent(v, move(1));
    expect(applyGameEvent(v, move(1))).toBe("ignored");
    expect(v.game?.moves).toHaveLength(1);
  });

  it("asks for a REST resync on a gap and does not apply the event", () => {
    const v = fresh();
    applyGameEvent(v, move(1));
    expect(applyGameEvent(v, move(3, "g1f3", "Nf3"))).toBe("resync");
    expect(v.game?.ply).toBe(1);
    expect(v.sanByPly[3]).toBeUndefined();
  });

  it("asks for a resync when the first event seen is not ply 1", () => {
    const v = fresh();
    expect(applyGameEvent(v, move(2))).toBe("resync");
    expect(v.game?.ply).toBe(0);
  });

  it("clears pending offers", () => {
    const v = fresh();
    v.game!.drawOfferedBy = "white";
    v.game!.takebackOfferedBy = "black";
    applyGameEvent(v, move(1));
    expect(v.game?.drawOfferedBy).toBeUndefined();
    expect(v.game?.takebackOfferedBy).toBeUndefined();
  });
});

describe("applyGameEvent — other events", () => {
  it("sets and clears draw and takeback offers", () => {
    const v = fresh();
    applyGameEvent(v, { type: "draw_offer", gameId: "g1", by: "white" });
    expect(v.game?.drawOfferedBy).toBe("white");
    applyGameEvent(v, { type: "draw_offer", gameId: "g1", by: null });
    expect(v.game?.drawOfferedBy).toBeUndefined();

    applyGameEvent(v, { type: "takeback_offer", gameId: "g1", by: "black" });
    expect(v.game?.takebackOfferedBy).toBe("black");
  });

  it("updates clocks without a resync", () => {
    const v = fresh();
    expect(applyGameEvent(v, { type: "clock", gameId: "g1", whiteMs: 1, blackMs: 2, deadlineAt: 3 })).toBe("applied");
    expect(v.game).toMatchObject({ whiteMs: 1, blackMs: 2, deadlineAt: 3 });
  });

  it("takeback and game_over both request a resync", () => {
    const v = fresh();
    expect(
      applyGameEvent(v, { type: "takeback", gameId: "g1", ply: 0, turn: "white", whiteMs: 1, blackMs: 1, deadlineAt: 5 }),
    ).toBe("resync");

    expect(
      applyGameEvent(v, { type: "game_over", gameId: "g1", status: "finished", result: "1-0", termination: "resignation" }),
    ).toBe("resync");
    expect(v.game).toMatchObject({ status: "finished", result: "1-0", termination: "resignation" });
  });

  it("ignores everything before the game has loaded", () => {
    expect(applyGameEvent({ game: null, sanByPly: {} }, move(1))).toBe("ignored");
  });
});