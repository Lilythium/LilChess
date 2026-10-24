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

  it("ignores everything before the game has loaded", () => {
    expect(applyGameEvent({ game: null, sanByPly: {} }, move(1))).toBe("ignored");
  });
});

describe("applyGameEvent — takeback", () => {
  const takeback = (ply: number): GameEvent => ({
    type: "takeback", gameId: "g1", ply, turn: ply % 2 === 0 ? "white" : "black",
    whiteMs: 41_000, blackMs: 52_000, deadlineAt: 77_000,
  });

  it("truncates moves and SANs locally, without a resync", () => {
    const v = fresh();
    applyGameEvent(v, move(1, "e2e4", "e4"));
    applyGameEvent(v, move(2, "e7e5", "e5"));
    v.game!.takebackOfferedBy = "white";

    expect(applyGameEvent(v, takeback(0))).toBe("applied");
    expect(v.game?.moves).toEqual([]);
    expect(v.game?.ply).toBe(0);
    expect(v.game?.turn).toBe("white");
    expect(v.game).toMatchObject({ whiteMs: 41_000, blackMs: 52_000, deadlineAt: 77_000 });
    expect(v.game?.takebackOfferedBy).toBeUndefined();
    expect(v.sanByPly).toEqual({});
  });

  it("keeps the moves that were not taken back", () => {
    const v = fresh();
    applyGameEvent(v, move(1, "e2e4", "e4"));
    applyGameEvent(v, move(2, "e7e5", "e5"));
    applyGameEvent(v, move(3, "g1f3", "Nf3"));
    applyGameEvent(v, move(4, "b8c6", "Nc6"));

    expect(applyGameEvent(v, takeback(2))).toBe("applied");
    expect(v.game?.moves).toEqual(["e2e4", "e7e5"]);
    expect(v.sanByPly).toEqual({ 1: "e4", 2: "e5" });
  });

  it("asks for a resync when the takeback is ahead of what we hold", () => {
    const v = fresh();
    applyGameEvent(v, move(1));
    expect(applyGameEvent(v, takeback(4))).toBe("resync");
    expect(v.game?.ply).toBe(1);
  });
});

describe("applyGameEvent — game_over", () => {
  const over = (extra: Partial<Extract<GameEvent, { type: "game_over" }>> = {}): GameEvent => ({
    type: "game_over", gameId: "g1", status: "finished", result: "1-0", termination: "resignation",
    ply: 1, whiteMs: 12_000, blackMs: 34_000, ...extra,
  });

  it("closes the game from the event alone", () => {
    const v = fresh();
    applyGameEvent(v, move(1));
    v.game!.drawOfferedBy = "black";

    expect(applyGameEvent(v, over())).toBe("applied");
    expect(v.game).toMatchObject({
      status: "finished", result: "1-0", termination: "resignation", whiteMs: 12_000, blackMs: 34_000,
    });
    expect(v.game?.drawOfferedBy).toBeUndefined();
  });

  it("resyncs when the server did not send the final ply and clocks (older server)", () => {
    const v = fresh();
    applyGameEvent(v, move(1));
    const legacy: GameEvent = { type: "game_over", gameId: "g1", status: "finished", result: "1-0", termination: "resignation" };

    expect(applyGameEvent(v, legacy)).toBe("resync");
    expect(v.game).toMatchObject({ status: "started" }); // untouched: the resync decides
  });

  it("resyncs when we missed a move before the game ended", () => {
    const v = fresh();
    expect(applyGameEvent(v, over({ ply: 3 }))).toBe("resync");
    expect(v.game?.status).toBe("started");
  });

  it("handles an aborted game", () => {
    const v = fresh();
    expect(applyGameEvent(v, over({ status: "aborted", result: undefined, termination: "abort", ply: 0 }))).toBe("applied");
    expect(v.game).toMatchObject({ status: "aborted", termination: "abort" });
  });
});
