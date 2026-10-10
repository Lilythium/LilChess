import type { Color, GameResult } from "../core/types.js";

export const SIMUL_STATUSES = ["open", "running", "completed", "cancelled"] as const;
export type SimulStatus = (typeof SIMUL_STATUSES)[number];

export const SIMUL_INVITE_STATUSES = ["invited", "accepted", "declined"] as const;
export type SimulInviteStatus = (typeof SIMUL_INVITE_STATUSES)[number];

export const HOST_COLORS = ["white", "black", "alternate"] as const;
export type HostColor = (typeof HOST_COLORS)[number];

export const MAX_SIMUL_PLAYERS = 20;
export const MAX_SIMUL_INVITES = 40;

/** The host's colour on board `seat` (1-based). "alternate" is white on odd boards. */
export function hostColorForSeat(seat: number, pref: HostColor): Color {
  if (pref === "alternate") return seat % 2 === 1 ? "white" : "black";
  return pref;
}

// A live game aborts if the side to move hasn't moved within FIRST_MOVE_WINDOW_MS (30 s). A host who has to
// open N boards can't manage that, so the host's first move on each live simul board gets a longer window.
export const SIMUL_FIRST_MOVE_PER_BOARD_MS = 45_000;
export const SIMUL_FIRST_MOVE_MIN_MS = 3 * 60_000;
export const SIMUL_FIRST_MOVE_MAX_MS = 20 * 60_000;

export function simulFirstMoveWindowMs(boards: number): number {
  return Math.min(SIMUL_FIRST_MOVE_MAX_MS, Math.max(SIMUL_FIRST_MOVE_MIN_MS, boards * SIMUL_FIRST_MOVE_PER_BOARD_MS));
}

export type BoardStatus = "started" | "finished" | "aborted";

export interface SimulBoardResult {
  hostColor: Color;
  status: BoardStatus;
  result: GameResult | null;
}

export interface SimulScore {
  wins: number; draws: number; losses: number;
  ongoing: number; aborted: number;
  played: number; points: number;
}

/** Host's score. Aborted boards don't count as played. */
export function simulScore(boards: SimulBoardResult[]): SimulScore {
  const s = { wins: 0, draws: 0, losses: 0, ongoing: 0, aborted: 0 };
  for (const b of boards) {
    if (b.status === "started") s.ongoing++;
    else if (b.status === "aborted" || b.result === null) s.aborted++;
    else if (b.result === "1/2-1/2") s.draws++;
    else if ((b.result === "1-0") === (b.hostColor === "white")) s.wins++;
    else s.losses++;
  }
  const played = s.wins + s.draws + s.losses;
  return { ...s, played, points: s.wins + s.draws / 2 };
}

export interface SimulBoardState {
  gameId: string;
  seat: number;
  hostColor: Color;
  status: BoardStatus;
  turn: Color;
  deadlineAt: number;
}

const needsHost = (b: SimulBoardState) => b.status === "started" && b.turn === b.hostColor;

/** The most urgent board where it is the host's move (never `currentGameId`), or null. */
export function nextBoardForHost(boards: SimulBoardState[], currentGameId: string | null): string | null {
  const candidates = boards.filter((b) => needsHost(b) && b.gameId !== currentGameId);
  candidates.sort((a, b) => a.deadlineAt - b.deadlineAt || a.seat - b.seat);
  return candidates[0]?.gameId ?? null;
}

/** Previous/next unfinished board by seat, wrapping around. */
export function adjacentBoard(boards: SimulBoardState[], currentGameId: string, delta: 1 | -1): string | null {
  const live = boards.filter((b) => b.status === "started").sort((a, b) => a.seat - b.seat);
  if (live.length === 0) return null;
  const i = live.findIndex((b) => b.gameId === currentGameId);
  if (i === -1) return (delta === 1 ? live[0] : live[live.length - 1])!.gameId; // current board is over
  if (live.length === 1) return null;
  return live[(i + delta + live.length) % live.length]!.gameId;
}