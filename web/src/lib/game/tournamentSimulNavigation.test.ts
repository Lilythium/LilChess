import { describe, expect, it, vi } from "vitest";
import type { TournamentSimulBoard } from "../types";
import {
  boardsForCurrentGame,
  manuallyNavigateAdjacentTournamentBoard,
  nextTournamentSimulBoard,
  resyncAndAdvanceAfterHostMove,
  tournamentSimulCounts,
} from "./tournamentSimulNavigation";

const board = (gameId: string, seat: number, over: Partial<TournamentSimulBoard> = {}): TournamentSimulBoard => ({
  gameId,
  seat,
  hostColor: "white",
  status: "started",
  turn: "black",
  deadlineAt: 1000 * seat,
  ...over,
});

describe("tournament simul board synchronization", () => {
  it("reflects a different game's completion from the refreshed board list", () => {
    const refreshed = [board("a", 1), board("b", 2, { status: "finished" })];
    const current = boardsForCurrentGame(refreshed, "a", "black", "started", 1500);

    expect(current.map(({ gameId, status }) => [gameId, status])).toEqual([
      ["a", "started"], ["b", "finished"],
    ]);
    expect(tournamentSimulCounts(current)).toEqual({ left: 1, toMove: 0 });
  });

  it("selects a board as soon as it becomes the host's turn", () => {
    const boards = [
      board("current", 1),
      board("waiting", 2, { deadlineAt: 500, turn: "black" }),
    ];
    expect(nextTournamentSimulBoard(boards, "current")).toBeNull();

    boards[1] = { ...boards[1]!, turn: "white" };
    expect(nextTournamentSimulBoard(boards, "current")).toBe("waiting");
  });

  it("advances using the board list returned by resync, not the stale list", async () => {
    const boards = [
      board("current", 1, { deadlineAt: 100 }),
      board("urgent", 2, { deadlineAt: 200, turn: "black" }),
      board("later", 3, { deadlineAt: 300, turn: "white" }),
    ];
    const navigate = vi.fn();
    const advanced = await resyncAndAdvanceAfterHostMove({
      autoAdvance: true,
      hostColor: "white",
      gameTurn: "white",
      gameId: "current",
      refresh: async () => {
        boards[1] = { ...boards[1]!, turn: "white" };
        return true;
      },
      getBoards: () => boards,
      navigate,
    });

    expect(advanced).toBe(true);
    expect(navigate).toHaveBeenCalledExactlyOnceWith("urgent");
  });

  it("keeps manual adjacent navigation available when auto-advance is disabled", () => {
    const autoAdvance = false;
    const boards = [board("current", 1), board("next", 2)];
    const navigate = vi.fn();

    expect(autoAdvance).toBe(false);
    expect(manuallyNavigateAdjacentTournamentBoard(boards, "current", 1, navigate)).toBe(true);
    expect(navigate).toHaveBeenCalledExactlyOnceWith("next");
  });
});