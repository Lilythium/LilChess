import type { Color, GameResult, Termination } from "../core/types.js";
import type { SimulStatus } from "../simuls/simul.js";

export type GameEvent =
  | {
      type: "move";
      gameId: string;
      ply: number;
      uci: string;
      san: string;
      turn: Color;
      whiteMs: number;
      blackMs: number;
      deadlineAt: number;
    }
  | {
      type: "clock";
      gameId: string;
      whiteMs: number;
      blackMs: number;
      deadlineAt: number;
    }
  | {
      type: "draw_offer";
      gameId: string;
      by: Color | null; // null = offer withdrawn/declined
    }
  | {
      type: "takeback_offer";
      gameId: string;
      by: Color | null; // null = offer declined
    }
  | {
      type: "takeback";
      gameId: string;
      ply: number;
      turn: Color;
      whiteMs: number;
      blackMs: number;
      deadlineAt: number;
    }
  | {
      type: "game_over";
      gameId: string;
      status: "finished" | "aborted";
      result?: GameResult;      // absent for aborted games
      termination?: Termination;
    };

export type ClientMessage = { type: "move"; ply: number; uci: string };

export type UserEvent =
  | { type: "pairing_ready"; tournamentId: string; gameId: string; round: number }
  | { type: "simul_invite"; simulId: string; name: string; hostName: string }
  | { type: "simul_started"; simulId: string; gameId: string };

// Pushed to everyone watching a simul's overview (players, host, spectators).
export type SimulEvent =
  | {
      type: "simul_board";
      simulId: string;
      gameId: string;
      ply: number;
      turn: Color;
      fen: string;
      lastMove: string | null;
      status: "started" | "finished" | "aborted";
      result?: GameResult;
      termination?: Termination;
      whiteMs: number;
      blackMs: number;
      deadlineAt: number;
      drawOfferedBy: Color | null;
    }
  | { type: "simul_state"; simulId: string; status: SimulStatus }
  | { type: "simul_roster"; simulId: string }; // someone accepted/declined: refetch