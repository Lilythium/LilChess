import type { ClockConfig, Color, GameState } from "@lilchess/shared";
import { config } from "../config.js";

export interface Message {
  subject: string;
  text: string;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// The SPA uses hash routing: https://host/#/game/abc
export const link = (hashPath: string) => `${config.baseOrigin}/#${hashPath}`;

export function describeClock(c: ClockConfig): string {
  if (c.mode === "live") return `${(c.initialMs ?? 0) / 60_000}+${(c.incrementMs ?? 0) / 1000}`;
  const d = c.daysPerMove ?? 1;
  return `${d} day${d === 1 ? "" : "s"} per move`;
}

export function footer(unsubscribeToken: string | null): string {
  const lines = ["", "--", `Notification settings: ${link("/settings")}`];
  if (unsubscribeToken) lines.push(`Turn off all emails: ${link("/unsubscribe/" + unsubscribeToken)}`);
  return lines.join("\n") + "\n";
}

export function outcomeFor(state: GameState, me: Color): string {
  if (state.status === "aborted") return "The game was aborted.";
  const how = (state.termination ?? "").replace(/_/g, " ");
  if (state.result === "1/2-1/2") return `The game ended in a draw (${how}).`;
  const iWon = (state.result === "1-0") === (me === "white");
  return `You ${iWon ? "won" : "lost"} by ${how}.`;
}

// The challenge link in the lobby is replaced whenever the sender re-challenges, so point at the lobby.
export const challengeReceived = (from: string, clock: ClockConfig): Message => ({
  subject: `${cap(from)} challenged you to a ${describeClock(clock)} game`,
  text: `${cap(from)} challenged you to a ${clock.mode} game (${describeClock(clock)}).\n\nSee it in the lobby: ${link("/")}\n`,
});

export const challengeAccepted = (opponent: string, gameId: string, youMoveFirst: boolean): Message => ({
  subject: `${cap(opponent)} accepted your challenge`,
  text:
    `${cap(opponent)} accepted your correspondence challenge.\n` +
    (youMoveFirst ? "You play white, so it's your move.\n" : "You play black; they move first.\n") +
    `\nOpen the game: ${link("/game/" + gameId)}\n`,
});

export const yourTurn = (opponent: string, san: string, gameId: string, deadlineAt: number): Message => ({
  subject: `Your turn against ${cap(opponent)}`,
  text:
    `${cap(opponent)} played ${san}. It's your move.\n\n` +
    `You have until ${new Date(deadlineAt).toUTCString()} to reply.\n\n` +
    `Play: ${link("/game/" + gameId)}\n`,
});

export const gameCompleted = (opponent: string, gameId: string, outcome: string): Message => ({
  subject: `Your game against ${cap(opponent)} has ended`,
  text: `${outcome}\n\nView the game: ${link("/game/" + gameId)}\n`,
});

export const tournamentStarting = (name: string, tournamentId: string): Message => ({
  subject: `${name} is starting`,
  text: `The tournament "${name}" has started.\n\nOpen the tournament: ${link("/tournament/" + tournamentId)}\n`,
});

export const passwordReset = (username: string, token: string): Message => ({
  subject: "Reset your LilChess password",
  text:
    `Someone asked to reset the password for "${username}".\n\n` +
    `Choose a new one here (valid for 1 hour, works once): ${link("/reset/" + token)}\n\n` +
    `If that wasn't you, ignore this email and nothing changes.\n`,
});