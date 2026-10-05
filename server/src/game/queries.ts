import { getDb } from "../db/connection.js";
import { randomBytes } from "node:crypto";
import { createGame, normalizeUsername, type ClockConfig } from "@lilchess/shared";
import { insertGame, headToHead } from "../db/repositories/games.js";
import { getRatingBadge } from "../db/repositories/ratings.js";

// Helper to generate short random IDs like "aB9x2p"
function generateId(bytes = 4) {
return randomBytes(bytes).toString("hex");
}

export class ChallengeError extends Error {
status: number;
constructor(message: string, status: number) {
super(message);
this.name = "ChallengeError";
this.status = status;
}
}

const HOUR_MS = 60 * 60 * 1000;
export const LINK_TTL_MS = 24 * HOUR_MS;
export const LIVE_CHALLENGE_TTL_MS = HOUR_MS;
export const CORRESPONDENCE_CHALLENGE_TTL_MS = 48 * HOUR_MS;

export function challengeTtlMs(mode: string): number {
return mode === "correspondence" ? CORRESPONDENCE_CHALLENGE_TTL_MS : LIVE_CHALLENGE_TTL_MS;
}

export function countOpenChallengesFrom(userId: number): number {
const row = getDb()
.prepare(`SELECT COUNT(*) AS n FROM challenges WHERE from_user = ? AND expires_at > ?`)
.get(userId, Date.now()) as { n: number };
return row.n;
}

export function createChallenge(data: {
fromUser: number;
toUser?: number;
mode: string;
initialMs?: number;
incrementMs?: number;
daysPerMove?: number;
colorPref?: string;
isLink?: boolean;
rated?: boolean;
}) {
const db = getDb();
const id = generateId(data.isLink ? 8 : 4);
const now = Date.now();
const expiresAt = now + challengeTtlMs(data.mode);

// A user has at most one challenge per mode: creating a new one replaces the old one.
db.transaction(() => {
db.prepare(`DELETE FROM challenges WHERE from_user = ? AND mode = ?`).run(data.fromUser, data.mode);
db.prepare(`     INSERT INTO challenges (id, from_user, to_user, mode, initial_ms, increment_ms, days_per_move, color_pref, created_at, expires_at, is_link, rated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
id, data.fromUser, data.toUser ?? null, data.mode,
data.initialMs ?? null, data.incrementMs ?? null, data.daysPerMove ?? null,
data.colorPref ?? null, now, expiresAt, data.isLink ? 1 : 0, data.rated ? 1 : 0,
);
}).immediate();

return id;
}

export function acceptChallengeTx(challengeId: string, acceptingUserId: number) {
const db = getDb();

// Wrap in a transaction that runs strictly as BEGIN IMMEDIATE to prevent races
const transaction = db.transaction(() => {
const challenge = db.prepare(`SELECT * FROM challenges WHERE id = ?`).get(challengeId) as any;
if (!challenge) throw new ChallengeError("Challenge not found or already accepted", 404);
if (challenge.expires_at < Date.now()) {
// (the hourly purge in maintenance.ts removes it; a DELETE here would be rolled back by the throw anyway)
throw new ChallengeError("Challenge expired", 410);
}
if (challenge.from_user === acceptingUserId) throw new ChallengeError("Cannot accept your own challenge", 400);
if (challenge.to_user && challenge.to_user !== acceptingUserId) throw new ChallengeError("Not invited to this challenge", 403);
if (challenge.rated) {
  const me = db.prepare(`SELECT is_guest FROM users WHERE id = ?`).get(acceptingUserId) as { is_guest: number } | undefined;
  if (me?.is_guest) throw new ChallengeError("Guests can only play casual games. Register to play rated.", 403);
}

// Determine colors
let whiteId = challenge.from_user;
let blackId = acceptingUserId;
if (challenge.color_pref === "black" || (challenge.color_pref !== "white" && Math.random() > 0.5)) {
  whiteId = acceptingUserId;
  blackId = challenge.from_user;
}

const gameId = generateId(5); // slightly longer ID for games
const clock: ClockConfig =
  challenge.mode === "live"
    ? { mode: "live", initialMs: challenge.initial_ms, incrementMs: challenge.increment_ms ?? 0 }
    : { mode: "correspondence", daysPerMove: challenge.days_per_move };

insertGame(gameId, whiteId, blackId, createGame({ clock, now: Date.now(), rated: challenge.rated }));

// Delete the consumed challenge
db.prepare(`DELETE FROM challenges WHERE id = ?`).run(challengeId);

return gameId;
});

// Execute the transaction
return transaction.immediate();
}

const GAME_ROW_COLUMNS = `
  g.id, g.white_id, g.black_id, wu.username AS white_name, bu.username AS black_name,
  g.mode, g.initial_ms, g.increment_ms, g.days_per_move, g.status, g.result, g.termination,
  g.ply, g.deadline_at, g.ended_at, g.fen, g.last_move`;

const GAME_ROW_FROM = `
  FROM games g
  JOIN users wu ON wu.id = g.white_id
  JOIN users bu ON bu.id = g.black_id`;

interface GameListRow {
id: string;
white_id: number;
black_id: number;
ply: number;
[k: string]: unknown;
}

// Fetch games for a specific user, categorized by turn
export function getMyGames(userId: number) {
const db = getDb();

const active = db.prepare(`     SELECT ${GAME_ROW_COLUMNS} ${GAME_ROW_FROM}
    WHERE g.status = 'started' AND (g.white_id = :me OR g.black_id = :me)
    ORDER BY g.deadline_at ASC, g.created_at DESC
  `).all({ me: userId }) as GameListRow[];

const finished = db.prepare(`     SELECT ${GAME_ROW_COLUMNS} ${GAME_ROW_FROM}
    WHERE g.status <> 'started' AND (g.white_id = :me OR g.black_id = :me)
    ORDER BY g.ended_at DESC LIMIT 50
  `).all({ me: userId }) as GameListRow[];

const myTurn: GameListRow[] = [];
const theirTurn: GameListRow[] = [];

for (const g of active) {
const whiteToMove = g.ply % 2 === 0;
const mine = whiteToMove ? g.white_id === userId : g.black_id === userId;
(mine ? myTurn : theirTurn).push(g);
}

return { myTurn, theirTurn, finished };
}

// Fetch user profile and Head-to-Head stats
export function getUserProfileWithH2H(targetUsername: string, viewerId: number) {
const db = getDb();

const targetUser = db.prepare(`SELECT id, username, created_at FROM users WHERE username = ?`).get(normalizeUsername(targetUsername)) as any;
if (!targetUser) return null;

// If viewing someone else, calculate H2H stats
let h2h = null;
if (targetUser.id !== viewerId) {
   const r = headToHead(viewerId, targetUser.id) as { wins: number | null; draws: number | null; losses: number | null };
   h2h = { wins: r.wins ?? 0, draws: r.draws ?? 0, losses: r.losses ?? 0 };


}

const games = db.prepare(`     SELECT g.id, g.mode, g.initial_ms, g.increment_ms, g.days_per_move,
          g.result, g.termination, g.ended_at,
          g.white_id, g.black_id, wu.username AS white_name, bu.username AS black_name,
          g.fen, g.last_move
    FROM games g
    JOIN users wu ON wu.id = g.white_id
    JOIN users bu ON bu.id = g.black_id
    WHERE g.status = 'finished' AND (g.white_id = ? OR g.black_id = ?)
    ORDER BY g.ended_at DESC LIMIT 20
  `).all(targetUser.id, targetUser.id) as any[];

return { profile: targetUser, h2h, games };
}

export function getGamePlayers(gameId: string) {
return getDb().prepare(`     SELECT g.white_id AS whiteId, wu.username AS whiteName,
           g.black_id AS blackId, bu.username AS blackName,
           g.created_at AS createdAt
    FROM games g
    JOIN users wu ON wu.id = g.white_id
    JOIN users bu ON bu.id = g.black_id
    WHERE g.id = ?
  `).get(gameId) as
| { whiteId: number; whiteName: string; blackId: number; blackName: string; createdAt: number }
| undefined;
}

export function listChallenges(userId: number) {
const rows = getDb().prepare(`     SELECT c.*, u.username AS from_name
    FROM challenges c JOIN users u ON u.id = c.from_user
    WHERE c.expires_at > ?
      AND (c.from_user = ? OR (c.is_link = 0 AND (c.to_user IS NULL OR c.to_user = ?)))
    ORDER BY c.created_at DESC
  `).all(Date.now(), userId, userId) as any[];

return {
mine: rows.filter((r) => r.from_user === userId),
forMe: rows.filter((r) => r.to_user === userId),
open: rows.filter((r) => r.from_user !== userId && r.to_user === null),
};
}

export function cancelChallenge(id: string, userId: number): boolean {
return getDb().prepare(`DELETE FROM challenges WHERE id = ? AND from_user = ?`)
.run(id, userId).changes > 0;
}

// Games in progress, for the "Watch live" page. Live-clock games first, most recently active first.
export function getLiveGames(limit = 20) {
  const rows = getDb().prepare(`
    SELECT g.id, g.white_id, g.black_id, wu.username AS white_name, bu.username AS black_name,
           g.mode, g.initial_ms, g.increment_ms, g.days_per_move, g.ply, g.deadline_at, g.fen
    FROM games g
    JOIN users wu ON wu.id = g.white_id
    JOIN users bu ON bu.id = g.black_id
    WHERE g.status = 'started'
    ORDER BY (g.mode = 'live') DESC, g.turn_started_at DESC
    LIMIT ?
  `).all(limit) as any[];

  return rows;
}

// Public preview for the invite page. Works for any live challenge; never exposes user ids.
export function getInvitePreview(id: string) {
  return getDb()
    .prepare(
      `SELECT c.id, u.username AS from_name, c.mode, c.initial_ms, c.increment_ms, c.days_per_move, c.rated,
              c.color_pref, (c.to_user IS NOT NULL) AS targeted
       FROM challenges c JOIN users u ON u.id = c.from_user
       WHERE c.id = ? AND c.expires_at > ?`,
    )
    .get(id, Date.now()) as
    | {
        id: string;
        from_name: string;
        mode: "live" | "correspondence";
        initial_ms: number | null;
        increment_ms: number | null;
        days_per_move: number | null;
        rated: number;
        color_pref: string | null;
        targeted: number;
      }
    | undefined;
}