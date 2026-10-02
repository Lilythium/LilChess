import type { Color, GameResult, Termination } from "../core/types.js";

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