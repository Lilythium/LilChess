import { adjacentBoard, nextBoardForHost } from "@lilchess/shared";
import type { TournamentSimulBoard } from "../types";

export function boardsForCurrentGame(
  boards: TournamentSimulBoard[],
  gameId: string,
  gameTurn: "white" | "black",
  gameStatus: "started" | "finished" | "aborted",
  gameDeadlineAt: number,
): TournamentSimulBoard[] {
  return boards.map((board) => board.gameId === gameId
    ? { ...board, turn: gameTurn, status: gameStatus, deadlineAt: gameDeadlineAt }
    : board);
}

export function tournamentSimulCounts(boards: TournamentSimulBoard[]) {
  return {
    left: boards.filter((board) => board.status === "started").length,
    toMove: boards.filter((board) => board.status === "started" && board.turn === board.hostColor).length,
  };
}

export function nextTournamentSimulBoard(boards: TournamentSimulBoard[], currentGameId: string): string | null {
  return nextBoardForHost(boards, currentGameId);
}

export function adjacentTournamentSimulBoard(
  boards: TournamentSimulBoard[],
  currentGameId: string,
  delta: 1 | -1,
): string | null {
  return adjacentBoard(boards, currentGameId, delta);
}

export function manuallyNavigateAdjacentTournamentBoard(
  boards: TournamentSimulBoard[],
  currentGameId: string,
  delta: 1 | -1,
  navigate: (gameId: string) => void,
): boolean {
  const nextId = adjacentTournamentSimulBoard(boards, currentGameId, delta);
  if (!nextId) return false;
  navigate(nextId);
  return true;
}

export async function resyncAndAdvanceAfterHostMove(options: {
  autoAdvance: boolean;
  hostColor: "white" | "black" | undefined;
  gameTurn: "white" | "black";
  gameId: string;
  refresh: () => Promise<boolean>;
  getBoards: () => TournamentSimulBoard[];
  navigate: (gameId: string) => void;
}): Promise<boolean> {
  const refreshed = await options.refresh();
  if (!refreshed || !options.autoAdvance || options.hostColor !== options.gameTurn) return false;

  const nextId = nextTournamentSimulBoard(options.getBoards(), options.gameId);
  if (!nextId) return false;
  options.navigate(nextId);
  return true;
}
