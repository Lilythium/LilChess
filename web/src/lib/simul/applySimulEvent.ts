import { simulScore, type SimulEvent } from "@lilchess/shared";
import type { SimulDetail } from "./types";

/** Returns the new detail, or "resync" when the event refers to something we haven't loaded. */
export function applySimulEvent(detail: SimulDetail, event: SimulEvent): SimulDetail | "resync" {
  if (event.simulId !== detail.simul.id) return detail;
  switch (event.type) {
    case "simul_roster":
      return "resync";
    case "simul_state":
      return { ...detail, simul: { ...detail.simul, status: event.status } };
    case "simul_board": {
      const index = detail.boards.findIndex((b) => b.gameId === event.gameId);
      if (index === -1) return "resync";
      const board = {
        ...detail.boards[index]!,
        ply: event.ply, turn: event.turn, fen: event.fen, lastMove: event.lastMove,
        status: event.status, result: event.result ?? null, termination: event.termination ?? null,
        whiteMs: event.whiteMs, blackMs: event.blackMs, deadlineAt: event.deadlineAt,
        drawOfferedBy: event.drawOfferedBy,
      };
      const boards = detail.boards.map((b, i) => (i === index ? board : b));
      return { ...detail, boards, score: simulScore(boards) };
    }
  }
}