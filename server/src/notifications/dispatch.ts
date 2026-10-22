import { opponent, type ClockConfig, type GameState, type NotificationKind } from "@lilchess/shared";
import { getDb } from "../db/connection.js";
import { logger } from "../logger.js";
import { discordEnabled, sendDiscord } from "./discord.js";
import { emailEnabled, sendMail } from "./mailer.js";
import { pushEnabled, sendPush } from "./push.js";
import { claimNotification, discordRecipientFor, pushRecipientFor, recipientFor, type Recipient } from "./queries.js";
import { sendWebhook, webhookEnabled } from "./webhook.js";
import * as t from "./templates.js";

const log = logger.child({ mod: "notify" });

// The one door every notification goes through: email, Discord, webhook and Web Push. Call it AFTER the
// database transaction has committed. It never throws and never awaits a send. Each channel is independent,
// and a failure on one never blocks the others.
export function notifyUser(
  userId: number,
  kind: NotificationKind,
  dedupKey: string,
  build: (r: Recipient) => t.Message,
): void {
  if (emailEnabled()) {
    try {
      const r = recipientFor(userId, kind);
      if (r && claimNotification(userId, dedupKey, kind)) {
        const { subject, text } = build(r);
        void sendMail({
          to: r.email,
          subject,
          text: text + t.footer(r.unsubscribeToken),
          headers: r.unsubscribeToken
            ? { "List-Unsubscribe": `<${t.link("/unsubscribe/" + r.unsubscribeToken)}>` }
            : undefined,
        });
      }
    } catch (err) {
      log.warn({ err, kind }, "email notification failed");
    }
  }

  if (discordEnabled()) {
    try {
      const d = discordRecipientFor(userId, kind);
      // Same dedup table as email, with a channel prefix so the two don't suppress each other.
      if (d && claimNotification(userId, `discord:${dedupKey}`, kind)) {
        const { subject, text } = build({ id: d.id, username: d.username, email: "", unsubscribeToken: null });
        void sendDiscord(d.discordId, subject, text);
      }
    } catch (err) {
      log.warn({ err, kind }, "discord notification failed");
    }
  }

  if (webhookEnabled()) {
    try {
      const user = getDb()
        .prepare(`SELECT id, username FROM users WHERE id = ? AND is_guest = 0 AND disabled_at IS NULL`)
        .get(userId) as { id: number; username: string } | undefined;
      if (user && claimNotification(userId, `webhook:${dedupKey}`, kind)) {
        const { subject, text } = build({ id: user.id, username: user.username, email: "", unsubscribeToken: null });
        const discord = discordRecipientFor(userId, kind);
        void sendWebhook(`For ${user.username}: ${subject}\n${text}`, discord?.discordId);
      }
    } catch (err) {
      log.warn({ err, kind }, "webhook notification failed");
    }
  }

  if (pushEnabled()) {
    try {
      const p = pushRecipientFor(userId, kind);
      // Same dedup table again, with its own prefix. One claim covers all of the user's devices.
      if (p && claimNotification(userId, `push:${dedupKey}`, kind)) {
        const { subject, text, path = "/" } = build({ id: p.id, username: p.username, email: "", unsubscribeToken: null });
        void sendPush(p.subs, {
          title: subject,
          // The first paragraph of the message; the rest is the email's link and signature.
          body: text.split("\n\n")[0] ?? subject,
          path,
          // A newer "your turn" in the same game replaces the older one; everything else stacks.
          tag: kind === "your_turn" ? path : dedupKey,
        });
      }
    } catch (err) {
      log.warn({ err, kind }, "push notification failed");
    }
  }
}

interface Seat { id: number; name: string }
interface GameSeats { mode: string; white: Seat; black: Seat }

function gameSeats(gameId: string): GameSeats | undefined {
  const r = getDb()
    .prepare(
      `SELECT g.mode, g.white_id, g.black_id, wu.username AS white_name, bu.username AS black_name
       FROM games g JOIN users wu ON wu.id = g.white_id JOIN users bu ON bu.id = g.black_id
       WHERE g.id = ?`,
    )
    .get(gameId) as { mode: string; white_id: number; black_id: number; white_name: string; black_name: string } | undefined;
  return r && {
    mode: r.mode,
    white: { id: r.white_id, name: r.white_name },
    black: { id: r.black_id, name: r.black_name },
  };
}

// Targeted challenges only (open ones have no recipient). The challenge ID prevents duplicate
// sends without suppressing notifications for separate challenges from the same sender.
export function notifyChallengeReceived(o: {
  challengeId: string;
  fromName: string;
  toId: number;
  clock: ClockConfig;
}): void {
  notifyUser(o.toId, "challenge_received", `challenge:${o.challengeId}`, () =>
    t.challengeReceived(o.fromName, o.clock),
  );
}

// Correspondence only: live challengers are watching the lobby and get redirected instantly.
export function notifyChallengeAccepted(gameId: string, accepterId: number): void {
  const g = gameSeats(gameId);
  if (!g || g.mode !== "correspondence") return;
  const creatorIsWhite = g.white.id !== accepterId;
  const creator = creatorIsWhite ? g.white : g.black;
  const accepter = creatorIsWhite ? g.black : g.white;
  notifyUser(creator.id, "challenge_accepted", `accepted:${gameId}`, () =>
    t.challengeAccepted(accepter.name, gameId, creatorIsWhite),
  );
}

// `state` is the state after the move; state.turn is who must reply. The uci in the key means a
// takeback followed by a different move still emails, while an identical repeat does not.
export function notifyYourTurn(gameId: string, state: GameState, uci: string, san: string): void {
  if (state.status !== "started" || state.clock.mode !== "correspondence") return;
  const g = gameSeats(gameId);
  if (!g) return;
  const mover = g[state.turn];
  const other = g[opponent(state.turn)];
  notifyUser(mover.id, "your_turn", `turn:${gameId}:${state.ply}:${uci}`, () =>
    t.yourTurn(other.name, san, gameId, state.deadlineAt),
  );
}

// actorId = the user whose action ended the game, or null for a timeout (nobody acted: tell both).
export function notifyGameOver(gameId: string, state: GameState, actorId: number | null): void {
  if (state.status === "started" || state.clock.mode !== "correspondence") return;
  const g = gameSeats(gameId);
  if (!g) return;
  for (const color of ["white", "black"] as const) {
    const me = g[color];
    if (me.id === actorId) continue;
    const other = g[opponent(color)];
    notifyUser(me.id, "game_completed", `over:${gameId}`, () =>
      t.gameCompleted(other.name, gameId, t.outcomeFor(state, color)),
    );
  }
}

export function notifyTournamentStarting(tournamentId: string): void {
  const db = getDb();
  const tournament = db.prepare(`SELECT name FROM tournaments WHERE id = ?`).get(tournamentId) as
    { name: string } | undefined;
  if (!tournament) return;
  const participants = db.prepare(`
    SELECT user_id FROM tournament_participants WHERE tournament_id = ?
  `).all(tournamentId) as { user_id: number }[];
  for (const participant of participants) {
    notifyUser(participant.user_id, "tournament_starting", `tournament-started:${tournamentId}`, () =>
      t.tournamentStarting(tournament.name, tournamentId),
    );
  }
}

export function notifyTournamentCancelled(tournamentId: string): void {
  const db = getDb();
  const tournament = db.prepare(`SELECT name FROM tournaments WHERE id = ?`).get(tournamentId) as
    { name: string } | undefined;
  if (!tournament) return;
  const participants = db.prepare(`
    SELECT user_id FROM tournament_participants WHERE tournament_id = ?
  `).all(tournamentId) as { user_id: number }[];
  for (const participant of participants) {
    notifyUser(participant.user_id, "tournament_cancelled", `tournament-cancelled:${tournamentId}`, () =>
      t.tournamentCancelled(tournament.name, tournamentId),
    );
  }
}

export function notifySimulInvited(o: { simulId: string; simulName: string; hostName: string; toId: number }): void {
  notifyUser(o.toId, "simul_invited", `simul-invite:${o.simulId}`, () => t.simulInvited(o.hostName, o.simulName, o.simulId));
}