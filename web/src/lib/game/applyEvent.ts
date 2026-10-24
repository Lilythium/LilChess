import type { GameEvent, GameState } from "@lilchess/shared";

export interface EventTarget {
  game: GameState | null;
  sanByPly: Record<number, string>;
}

export type EventOutcome = "applied" | "ignored" | "resync";

// Mutates view in place. "resync" tells the caller to GET /api/games/:id.
export function applyGameEvent(view: EventTarget, event: GameEvent): EventOutcome {
  const game = view.game;
  if (!game) return "ignored";

  switch (event.type) {
    case "move": {
      if (event.ply <= game.ply) return "ignored"; // duplicate / already applied
      if (event.ply !== game.ply + 1) return "resync"; // gap: we missed an event
      game.moves.push(event.uci);
      game.ply = event.ply;
      game.turn = event.turn;
      game.whiteMs = event.whiteMs;
      game.blackMs = event.blackMs;
      game.deadlineAt = event.deadlineAt;
      game.drawOfferedBy = undefined;
      game.takebackOfferedBy = undefined;
      view.sanByPly[event.ply] = event.san;
      return "applied";
    }
    case "clock":
      game.whiteMs = event.whiteMs;
      game.blackMs = event.blackMs;
      game.deadlineAt = event.deadlineAt;
      return "applied";
    case "draw_offer":
      game.drawOfferedBy = event.by ?? undefined;
      return "applied";
    case "takeback_offer":
      game.takebackOfferedBy = event.by ?? undefined;
      return "applied";
    case "takeback": {
      // The event carries the new ply, side to move and clocks; everything else is a truncation of what we hold.
      if (event.ply > game.ply) return "resync"; // we are behind, so a truncation would be meaningless
      game.moves.length = event.ply;
      game.ply = event.ply;
      game.turn = event.turn;
      game.whiteMs = event.whiteMs;
      game.blackMs = event.blackMs;
      game.deadlineAt = event.deadlineAt;
      game.drawOfferedBy = undefined;
      game.takebackOfferedBy = undefined;
      for (const key of Object.keys(view.sanByPly)) {
        if (Number(key) > event.ply) delete view.sanByPly[Number(key)];
      }
      return "applied";
    }
    case "game_over": {
      // A server that predates the final ply and clocks sends neither: resync. So do we if we missed a move.
      if (event.ply === undefined || event.whiteMs === undefined || event.blackMs === undefined) return "resync";
      if (event.ply !== game.ply) return "resync";
      game.status = event.status;
      game.result = event.result;
      game.termination = event.termination;
      game.whiteMs = event.whiteMs;
      game.blackMs = event.blackMs;
      game.drawOfferedBy = undefined;
      game.takebackOfferedBy = undefined;
      return "applied";
    }
  }
}