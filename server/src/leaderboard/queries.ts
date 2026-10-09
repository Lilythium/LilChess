import { idlePeriods, inflateRd, PROVISIONAL_RD} from "@lilchess/shared";
import { getDb } from "../db/connection.js";

export const PERIODS = ["week", "month", "year", "all"] as const;
export type Period = (typeof PERIODS)[number];

const DAY_MS = 86_400_000;
const PERIOD_MS: Record<Period, number | null> = {
  week: 7 * DAY_MS,
  month: 30 * DAY_MS,
  year: 365 * DAY_MS,
  all: null,
};

export const TOP_N = 10;
/** A player needs at least this many rated games inside the window to be "most improved". */
export const MIN_PERIOD_GAMES = 3;

export interface LeaderboardOptions {
  minGames: number;
  inactiveDays: number; // 0 = never hide
  now?: number;
}

export interface TopPlayer {
  rank: number;
  username: string;
  rating: number;
  rd: number;
  provisional: boolean;
  games: number;
}

export interface Mover {
  rank: number;
  username: string;
  gain: number;
  from: number;
  to: number;
  games: number; // rated games inside the window
}

export interface ActivePlayer {
  rank: number;
  username: string;
  games: number; // rated games inside the window
}

export function topPlayers(variant: string, opts: LeaderboardOptions): { players: TopPlayer[]; ranked: number } {
  const now = opts.now ?? Date.now();
  const activeSince = opts.inactiveDays > 0 ? now - opts.inactiveDays * DAY_MS : 0;
  const db = getDb();

  const rows = db
    .prepare(
      `SELECT u.username, r.rating, r.rd, r.volatility, r.games, r.last_game_at
       FROM ratings r JOIN users u ON u.id = r.user_id
       WHERE r.variant = @variant AND u.is_guest = 0
         AND r.games >= @minGames AND r.last_game_at >= @activeSince
       ORDER BY r.rating DESC, r.games DESC, u.id ASC
       LIMIT @limit`,
    )
    .all({ variant, minGames: opts.minGames, activeSince, limit: TOP_N }) as {
    username: string; rating: number; rd: number; volatility: number; games: number; last_game_at: number | null;
  }[];

  const { n } = db
    .prepare(
      `SELECT COUNT(*) AS n FROM ratings r JOIN users u ON u.id = r.user_id
       WHERE r.variant = @variant AND u.is_guest = 0 AND r.games >= @minGames AND r.last_game_at >= @activeSince`,
    )
    .get({ variant, minGames: opts.minGames, activeSince }) as { n: number };

  const players = rows.map((r, i) => {
    // Stored RD is as of the last game; apply idle periods on read, same as the profile page.
    const shown = inflateRd(
      { rating: r.rating, rd: r.rd, volatility: r.volatility },
      idlePeriods(r.last_game_at, now),
    );
    return {
      rank: i + 1,
      username: r.username,
      rating: Math.round(shown.rating),
      rd: Math.round(shown.rd),
      provisional: shown.rd > PROVISIONAL_RD,
      games: r.games,
    };
  });
  return { players, ranked: n };
}

/** Most improved + most active over a window, both computed from rating_history. */
export function periodBoards(
  variant: string,
  period: Period,
  opts: LeaderboardOptions,
): { improved: Mover[]; active: ActivePlayer[] } {
  const now = opts.now ?? Date.now();
  const windowMs = PERIOD_MS[period];
  const since = windowMs === null ? 0 : now - windowMs;

  const rows = getDb()
    .prepare(
      `WITH w AS (
         SELECT user_id, rating_before, rating_after,
                ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY id ASC)  AS rn_first,
                ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY id DESC) AS rn_last,
                COUNT(*)     OVER (PARTITION BY user_id)                  AS n
         FROM rating_history
         WHERE variant = @variant AND created_at >= @since
       )
       SELECT u.username,
              MAX(CASE WHEN w.rn_first = 1 THEN w.rating_before END) AS start_rating,
              MAX(CASE WHEN w.rn_last  = 1 THEN w.rating_after  END) AS end_rating,
              MAX(w.n) AS games
       FROM w
       JOIN users u   ON u.id = w.user_id AND u.is_guest = 0
       JOIN ratings r ON r.user_id = w.user_id AND r.variant = @variant AND r.games >= @minGames
       GROUP BY w.user_id`,
    )
    .all({ variant, since, minGames: opts.minGames }) as {
    username: string; start_rating: number; end_rating: number; games: number;
  }[];

  const improved = rows
    .map((r) => {
      const from = Math.round(r.start_rating);
      const to = Math.round(r.end_rating);
      return { username: r.username, from, to, gain: to - from, games: r.games };
    })
    .filter((r) => r.games >= MIN_PERIOD_GAMES && r.gain > 0)
    .sort((a, b) => b.gain - a.gain || b.games - a.games || a.username.localeCompare(b.username))
    .slice(0, TOP_N)
    .map((r, i) => ({ rank: i + 1, ...r }));

  const active = rows
    .map((r) => ({ username: r.username, games: r.games }))
    .sort((a, b) => b.games - a.games || a.username.localeCompare(b.username))
    .slice(0, TOP_N)
    .map((r, i) => ({ rank: i + 1, ...r }));

  return { improved, active };
}