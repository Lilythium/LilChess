/** Profile-page rating helpers shared by the server (queries) and the web client (range picker). */

/** The sidebar delta covers this many rated games. migrations/0020 backfills with the same number. */
export const RECENT_DELTA_GAMES = 12;

const DAY_MS = 86_400_000;

export const RATING_HISTORY_RANGE_KEYS = ["1m", "3m", "1y", "all"] as const;
export type RatingHistoryRange = (typeof RATING_HISTORY_RANGE_KEYS)[number];

/** Time ranges offered on the rating-history graph. `ms: null` = no lower bound. */
export const RATING_HISTORY_RANGES: Record<RatingHistoryRange, { label: string; ms: number | null }> = {
  "1m": { label: "1 month", ms: 30 * DAY_MS },
  "3m": { label: "3 months", ms: 90 * DAY_MS },
  "1y": { label: "1 year", ms: 365 * DAY_MS },
  all: { label: "All time", ms: null },
};

export const DEFAULT_RATING_HISTORY_RANGE: RatingHistoryRange = "3m";
