import {
  DEFAULT_RATING,
  idlePeriods,
  inflateRd,
  isProvisional,
  rateGame,
  type GameResult,
  type Rating,
  type RatingBadge,
} from "@lilchess/shared";
import { getDb } from "../connection.js";

interface RatingRow {
  rating: number;
  rd: number;
  volatility: number;
  games: number;
  last_game_at: number | null;
}

export interface PlayerRating extends Rating {
  variant: string;
  games: number;
  provisional: boolean;
  lastGameAt: number | null;
}

export interface ProfileRating extends RatingBadge {
  variant: string;
  rd: number;
  games: number;
}

export interface RatingPoint {
  gameId: string;
  createdAt: number;
  rating: number;
}

// The stored RD is as of the last game; idle periods since then are applied on read.
function toPlayerRating(variant: string, row: RatingRow | undefined, now: number): PlayerRating {
  if (!row) return { ...DEFAULT_RATING, variant, games: 0, provisional: true, lastGameAt: null };
  const r = inflateRd(
    { rating: row.rating, rd: row.rd, volatility: row.volatility },
    idlePeriods(row.last_game_at, now),
  );
  return { ...r, variant, games: row.games, provisional: isProvisional(r.rd), lastGameAt: row.last_game_at };
}

export function getRating(userId: number, variant = "standard", now = Date.now()): PlayerRating {
  const row = getDb()
    .prepare(`SELECT rating, rd, volatility, games, last_game_at FROM ratings WHERE user_id = ? AND variant = ?`)
    .get(userId, variant) as RatingRow | undefined;
  return toPlayerRating(variant, row, now);
}

/** Rounded rating for display; null for guests (they never play rated games). */
export function getRatingBadge(userId: number, variant = "standard"): RatingBadge | null {
  const u = getDb().prepare(`SELECT is_guest FROM users WHERE id = ?`).get(userId) as
    | { is_guest: number }
    | undefined;
  if (!u || u.is_guest) return null;
  const r = getRating(userId, variant);
  return { rating: Math.round(r.rating), provisional: r.provisional };
}

export function getPlayerRatings(userId: number, now = Date.now()): ProfileRating[] {
  const rows = getDb()
    .prepare(
      `SELECT variant, rating, rd, volatility, games, last_game_at FROM ratings WHERE user_id = ? ORDER BY variant`,
    )
    .all(userId) as (RatingRow & { variant: string })[];
  const list = rows.length > 0 ? rows.map((r) => toPlayerRating(r.variant, r, now)) : [toPlayerRating("standard", undefined, now)];
  return list.map((r) => ({
    variant: r.variant,
    rating: Math.round(r.rating),
    rd: Math.round(r.rd),
    games: r.games,
    provisional: r.provisional,
  }));
}

/** Oldest-first, last `limit` rated games. */
export function getRatingHistory(userId: number, variant = "standard", limit = 200): RatingPoint[] {
  const rows = getDb()
    .prepare(
      `SELECT game_id, created_at, rating_after FROM rating_history
       WHERE user_id = ? AND variant = ? ORDER BY id DESC LIMIT ?`,
    )
    .all(userId, variant, limit) as { game_id: string; created_at: number; rating_after: number }[];
  return rows.reverse().map((r) => ({ gameId: r.game_id, createdAt: r.created_at, rating: Math.round(r.rating_after) }));
}

/** Displayed rating change per user id for one game, or null if it was not rated/settled. */
export function getGameRatingChanges(gameId: string): Record<number, number> | null {
  const rows = getDb()
    .prepare(`SELECT user_id, rating_before, rating_after FROM rating_history WHERE game_id = ?`)
    .all(gameId) as { user_id: number; rating_before: number; rating_after: number }[];
  if (rows.length === 0) return null;
  return Object.fromEntries(rows.map((r) => [r.user_id, Math.round(r.rating_after) - Math.round(r.rating_before)]));
}

/**
 * Applies the Glicko-2 update for a finished rated game. Idempotent: returns false (and writes
 * nothing) if the game is not a finished rated game, involves a guest, or was already settled.
 * Call it inside the transaction that finishes the game.
 */
export function settleRatings(gameId: string, now = Date.now()): boolean {
  const db = getDb();
  const g = db
    .prepare(`SELECT white_id, black_id, variant, status, result, rated FROM games WHERE id = ?`)
    .get(gameId) as
    | { white_id: number; black_id: number; variant: string; status: string; result: GameResult | null; rated: number }
    | undefined;
  if (!g || g.rated !== 1 || g.status !== "finished" || !g.result) return false;
  if (db.prepare(`SELECT 1 FROM rating_history WHERE game_id = ?`).get(gameId)) return false;

  const guests = db
    .prepare(`SELECT COUNT(*) AS n FROM users WHERE id IN (?, ?) AND is_guest = 1`)
    .get(g.white_id, g.black_id) as { n: number };
  if (guests.n > 0) return false;

  const white = getRating(g.white_id, g.variant, now);
  const black = getRating(g.black_id, g.variant, now);
  const next = rateGame(white, black, g.result);
  const whiteScore = g.result === "1-0" ? 1 : g.result === "0-1" ? 0 : 0.5;

  const upsert = db.prepare(`
    INSERT INTO ratings (user_id, variant, rating, rd, volatility, games, last_game_at)
    VALUES (@userId, @variant, @rating, @rd, @volatility, 1, @now)
    ON CONFLICT(user_id, variant) DO UPDATE SET
      rating = excluded.rating, rd = excluded.rd, volatility = excluded.volatility,
      games = ratings.games + 1, last_game_at = excluded.last_game_at
  `);
  const history = db.prepare(`
    INSERT INTO rating_history (
      game_id, user_id, variant, opponent_id, opponent_rating, score,
      rating_before, rd_before, rating_after, rd_after, volatility_after, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const apply = (userId: number, opponentId: number, me: PlayerRating, opp: PlayerRating, after: Rating, score: number) => {
    upsert.run({ userId, variant: g.variant, rating: after.rating, rd: after.rd, volatility: after.volatility, now });
    history.run(
      gameId, userId, g.variant, opponentId, opp.rating, score,
      me.rating, me.rd, after.rating, after.rd, after.volatility, now,
    );
  };
  apply(g.white_id, g.black_id, white, black, next.white, whiteScore);
  apply(g.black_id, g.white_id, black, white, next.black, 1 - whiteScore);
  return true;
}