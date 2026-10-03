import { inFirstMoveWindow, type Color, type GameState } from "@lilchess/shared";

export interface AbortWarning {
  secondsLeft: number;
  text: string;
  urgent: boolean;
}

// Non-null only while a live game is waiting on a first move (ply 0 or 1),
// when running out of time aborts the game instead of losing on time.
export function abortWarning(game: GameState, myColor: Color | null, serverNow: number): AbortWarning | null {
  if (game.status !== "started" || !inFirstMoveWindow(game)) return null;

  const secondsLeft = Math.max(0, Math.ceil((game.deadlineAt - serverNow) / 1000));
  let text: string;
  if (myColor === null) {
    text = `${game.turn === "white" ? "White" : "Black"} must move or the game will abort in ${secondsLeft}s`;
  } else if (myColor === game.turn) {
    text = `Make a move or the game will abort in ${secondsLeft}s`;
  } else {
    text = `Waiting for your opponent... The game will abort in ${secondsLeft}s`;
  }
  return { secondsLeft, text, urgent: secondsLeft <= 10 };
}