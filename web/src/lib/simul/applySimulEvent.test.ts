import { describe, expect, it } from "vitest";
import type { SimulEvent } from "@lilchess/shared";
import { applySimulEvent } from "./applySimulEvent";
import type { SimulDetail } from "./types";

const detail = (): SimulDetail => ({
  simul: { id: "s1", status: "running" } as SimulDetail["simul"],
  players: [],
  boards: [{
    seat: 1, userId: 2, username: "ann", gameId: "g1", hostColor: "white", turn: "white", status: "started",
    result: null, termination: null, ply: 0, fen: "start", lastMove: null, whiteMs: 1, blackMs: 1,
    deadlineAt: 10, drawOfferedBy: null,
  }],
  score: { wins: 0, draws: 0, losses: 0, ongoing: 1, aborted: 0, played: 0, points: 0 },
  viewer: { isHost: true, invite: null, gameId: null },
  serverNow: 0,
});

const boardEvent = (over: Partial<Extract<SimulEvent, { type: "simul_board" }>> = {}): SimulEvent => ({
  type: "simul_board", simulId: "s1", gameId: "g1", ply: 1, turn: "black", fen: "after e4", lastMove: "e2e4",
  status: "started", whiteMs: 1, blackMs: 1, deadlineAt: 20, drawOfferedBy: null, ...over,
});

describe("applySimulEvent", () => {
  it("updates a board in place", () => {
    const next = applySimulEvent(detail(), boardEvent());
    expect(next).not.toBe("resync");
    if (next === "resync") return;
    expect(next.boards[0]).toMatchObject({ ply: 1, turn: "black", fen: "after e4", lastMove: "e2e4", deadlineAt: 20 });
  });

  it("rescores when a board finishes", () => {
    const next = applySimulEvent(detail(), boardEvent({ status: "finished", result: "1-0", termination: "resignation" }));
    if (next === "resync") throw new Error("unexpected resync");
    expect(next.score).toMatchObject({ wins: 1, ongoing: 0, played: 1, points: 1 });
  });

  it("asks for a resync on unknown boards and roster changes, and ignores other simuls", () => {
    expect(applySimulEvent(detail(), boardEvent({ gameId: "nope" }))).toBe("resync");
    expect(applySimulEvent(detail(), { type: "simul_roster", simulId: "s1" })).toBe("resync");
    const d = detail();
    expect(applySimulEvent(d, boardEvent({ simulId: "other" }))).toBe(d);
  });

  it("applies state changes", () => {
    const next = applySimulEvent(detail(), { type: "simul_state", simulId: "s1", status: "completed" });
    if (next === "resync") throw new Error("unexpected resync");
    expect(next.simul.status).toBe("completed");
  });
});