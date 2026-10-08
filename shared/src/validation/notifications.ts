export const NOTIFICATION_KINDS = [
  "challenge_received",
  "challenge_accepted",
  "your_turn",
  "game_completed",
  "tournament_starting",
  "tournament_cancelled",
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const NOTIFICATION_LABELS: Record<NotificationKind, string> = {
  challenge_received: "Someone challenges me",
  challenge_accepted: "My correspondence challenge is accepted",
  your_turn: "It's my turn in a correspondence game",
  game_completed: "A correspondence game ends (when I didn't make the last move)",
  tournament_starting: "A tournament I joined starts",
  tournament_cancelled: "A tournament I joined is cancelled",
};