import { randomBytes, randomInt } from "node:crypto";
import { createGame } from "@lilchess/shared";
import { createGuest, createSession, type User } from "../auth/queries.js";
import { generateSessionToken, hashSessionToken } from "../auth/crypto.js";
import { config } from "../config.js";
import { getDb } from "../db/connection.js";
import { insertGame } from "../db/repositories/insertGame.js";
import { notifyDeadlineChanged } from "../game/deadlineBus.js";
import { demoBotId } from "./bot.js";

/** Demo games are 10 minute casual games. */
export const DEMO_INITIAL_MS = 10 * 60 * 1000;
/** Public-demo guard rails: the start endpoint is open to anyone, so it has hard ceilings. */
export const DEMO_MAX_ACTIVE_GAMES = 100;
export const DEMO_MAX_GUESTS = 5000;

export interface DemoStart {
  user: User;
  sessionToken: string;
  gameId: string;
}

/**
 * Creates a guest, a bearer session and a casual game against the practice bot, all at once, so a visitor with no
 * account and no invite link can play immediately. It deliberately does not use the challenge table: that allows
 * one challenge per user and mode, so a single bot could not offer one to each visitor. The session lasts as long
 * as the data does, because the purge below deletes the guest. Returns null while the demo is at capacity.
 */
export function startDemoGame(now = Date.now(), retentionMs = config.demoRetentionHours * 60 * 60 * 1000): DemoStart | null {
  const botId = demoBotId();
  if (botId === undefined) return null;
  const db = getDb();

  const result = db.transaction(() => {
    const active = db.prepare(`SELECT COUNT(*) AS n FROM games WHERE status = 'started' AND (white_id = ? OR black_id = ?)`).get(botId, botId) as { n: number };
    const guests = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE is_guest = 1`).get() as { n: number };
    if (active.n >= DEMO_MAX_ACTIVE_GAMES || guests.n >= DEMO_MAX_GUESTS) return null;

    const user = createGuest();
    const sessionToken = generateSessionToken();
    createSession(hashSessionToken(sessionToken), user.id, now + retentionMs);

    const gameId = randomBytes(5).toString("hex");
    const guestPlaysWhite = randomInt(2) === 0;
    insertGame(
      gameId,
      guestPlaysWhite ? user.id : botId,
      guestPlaysWhite ? botId : user.id,
      createGame({ clock: { mode: "live", initialMs: DEMO_INITIAL_MS, incrementMs: 0 }, now, variant: "standard", rated: false }),
    );
    return { user, sessionToken, gameId };
  }).immediate();

  if (result) notifyDeadlineChanged(); // the timeout scheduler needs to know about the new clock
  return result;
}

/**
 * Deletes demo data older than `retentionMs`: games between the practice bot and a guest, then the guests that no
 * longer have any game, with their sessions and challenges. Registered accounts, other people's games, ratings and
 * administrators are never touched. A guest who also played a real user keeps that game and the account.
 */
export function purgeDemoData(now: number, retentionMs: number): { games: number; guests: number } {
  const botId = demoBotId();
  if (botId === undefined) return { games: 0, guests: 0 };
  const db = getDb();
  const cutoff = now - retentionMs;

  return db.transaction(() => {
    const demoGames = `
      SELECT g.id FROM games g
      JOIN users u ON u.id = CASE WHEN g.white_id = @bot THEN g.black_id ELSE g.white_id END
      WHERE (g.white_id = @bot OR g.black_id = @bot) AND u.is_guest = 1 AND g.created_at < @cutoff`;
    const params = { bot: botId, cutoff };
    db.prepare(`DELETE FROM rating_history WHERE game_id IN (${demoGames})`).run(params);
    db.prepare(`DELETE FROM moves WHERE game_id IN (${demoGames})`).run(params);
    const games = db.prepare(`DELETE FROM games WHERE id IN (${demoGames})`).run(params).changes;

    const staleGuests = `
      SELECT u.id FROM users u
      WHERE u.is_guest = 1 AND u.created_at < @cutoff
        AND NOT EXISTS (SELECT 1 FROM games g WHERE g.white_id = u.id OR g.black_id = u.id)
        AND NOT EXISTS (SELECT 1 FROM ratings r WHERE r.user_id = u.id)
        AND NOT EXISTS (SELECT 1 FROM tournament_pairings p WHERE p.white_id = u.id OR p.black_id = u.id OR p.forfeit_by = u.id)`;
    db.prepare(`DELETE FROM sessions WHERE user_id IN (${staleGuests})`).run({ cutoff });
    db.prepare(`DELETE FROM challenges WHERE from_user IN (${staleGuests}) OR to_user IN (${staleGuests})`).run({ cutoff });
    const guests = db.prepare(`DELETE FROM users WHERE id IN (${staleGuests})`).run({ cutoff }).changes;
    return { games, guests };
  }).immediate();
}
