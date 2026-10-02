import type { Color, GameState } from "@lilchess/shared";

export interface BoardMode {
  movableColor: Color | undefined; // whose pieces the user may touch
  movesEnabled: boolean;           // legal moves can be played right now
  premovesEnabled: boolean;        // queue a move while the opponent is thinking
}

// `atLive` is false while the user is browsing earlier moves.
export function boardMode(game: GameState, myColor: Color | null, atLive: boolean): BoardMode {
  const playing = atLive && game.status === "started" && myColor !== null;
  return {
    movableColor: playing && myColor ? myColor : undefined,
    movesEnabled: playing && game.turn === myColor,
    // Premoves only make sense with a fast clock
    premovesEnabled: playing && game.clock.mode === "live",
  };
}