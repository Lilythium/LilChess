import type { GameState } from "@lilchess/shared";

export type NavAction = "first" | "prev" | "next" | "last";

// viewPly === null means "follow the live position".
export function stepView(current: number | null, total: number, action: NavAction): number | null {
  const at = current ?? total;
  let next: number;
  switch (action) {
    case "first":
      next = 0;
      break;
    case "prev":
      next = at - 1;
      break;
    case "next":
      next = at + 1;
      break;
    case "last":
      next = total;
      break;
  }
  next = Math.max(0, Math.min(total, next));
  return next === total ? null : next;
}

// Clicking a move in the list.
export function selectPly(ply: number, total: number): number | null {
  return ply >= total ? null : Math.max(0, ply);
}

// The game as it stood after `viewPly` plies (the same object when live).
export function gameAtPly(game: GameState, viewPly: number | null): GameState {
  if (viewPly === null || viewPly >= game.moves.length) return game;
  return {
    ...game,
    moves: game.moves.slice(0, viewPly),
    ply: viewPly,
    turn: viewPly % 2 === 0 ? "white" : "black",
  };
}