import { describe, expect, it } from "vitest";
import {
  adjacentBoard, hostColorForSeat, nextBoardForHost, simulFirstMoveWindowMs, simulScore,
  type SimulBoardState,
} from "./simul.js";

const board = (gameId: string, seat: number, over: Partial<SimulBoardState> = {}): SimulBoardState =>
  ({ gameId, seat, hostColor: "white", status: "started", turn: "white", deadlineAt: 1000 * seat, ...over });

describe("hostColorForSeat", () => {
  it("honours a fixed colour and alternates white on odd boards", () => {
    expect([1, 2, 3, 4].map((s) => hostColorForSeat(s, "alternate"))).toEqual(["white", "black", "white", "black"]);
    expect(hostColorForSeat(2, "white")).toBe("white");
    expect(hostColorForSeat(1, "black")).toBe("black");
  });
});

describe("simulFirstMoveWindowMs", () => {
  it("scales with the board count and is clamped", () => {
    expect(simulFirstMoveWindowMs(1)).toBe(3 * 60_000);
    expect(simulFirstMoveWindowMs(10)).toBe(450_000);
    expect(simulFirstMoveWindowMs(20)).toBe(15 * 60_000);
    expect(simulFirstMoveWindowMs(100)).toBe(20 * 60_000);
  });
});

describe("simulScore", () => {
  it("scores from the host's side and ignores aborted boards", () => {
    const s = simulScore([
      { hostColor: "white", status: "finished", result: "1-0" },
      { hostColor: "black", status: "finished", result: "1-0" },
      { hostColor: "black", status: "finished", result: "0-1" },
      { hostColor: "white", status: "finished", result: "1/2-1/2" },
      { hostColor: "white", status: "aborted", result: null },
      { hostColor: "white", status: "started", result: null },
    ]);
    expect(s).toEqual({ wins: 2, draws: 1, losses: 1, ongoing: 1, aborted: 1, played: 4, points: 2.5 });
  });
});

describe("nextBoardForHost", () => {
  it("picks the most urgent board where the host is to move, never the current one", () => {
    const boards = [board("a", 1, { deadlineAt: 500 }), board("b", 2, { deadlineAt: 100 }), board("c", 3, { deadlineAt: 300 })];
    expect(nextBoardForHost(boards, null)).toBe("b");
    expect(nextBoardForHost(boards, "b")).toBe("c");
  });
  it("skips boards waiting on the opponent and finished boards; breaks ties by seat", () => {
    const boards = [
      board("a", 1, { turn: "black" }), board("b", 2, { status: "finished" }),
      board("c", 3, { deadlineAt: 50 }), board("d", 4, { deadlineAt: 50 }),
    ];
    expect(nextBoardForHost(boards, null)).toBe("c");
    expect(nextBoardForHost([board("a", 1, { turn: "black" })], null)).toBeNull();
  });
});

describe("adjacentBoard", () => {
  const boards = [board("a", 1), board("b", 2, { status: "finished" }), board("c", 3)];
  it("wraps and skips finished boards", () => {
    expect(adjacentBoard(boards, "a", 1)).toBe("c");
    expect(adjacentBoard(boards, "c", 1)).toBe("a");
    expect(adjacentBoard(boards, "a", -1)).toBe("c");
  });
  it("handles a finished current board and a single board", () => {
    expect(adjacentBoard(boards, "b", 1)).toBe("a");
    expect(adjacentBoard(boards, "b", -1)).toBe("c");
    expect(adjacentBoard([board("a", 1)], "a", 1)).toBeNull();
    expect(adjacentBoard([], "a", 1)).toBeNull();
  });
});