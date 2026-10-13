-- v2.1: profile sidebar shows each variant's rating change over the last 12 rated games.
-- Stored on the ratings row (and kept current by settleRatings) so the profile page never has to scan history.
-- recent_delta = displayed rating after the newest game - displayed rating before the oldest of the last 12 games.

ALTER TABLE ratings ADD COLUMN recent_delta INTEGER NOT NULL DEFAULT 0;

UPDATE ratings SET recent_delta = COALESCE((
  SELECT CAST(ROUND(MAX(CASE WHEN w.rn = 1 THEN w.rating_after END))
            - ROUND(MAX(CASE WHEN w.rn = w.cnt THEN w.rating_before END)) AS INTEGER)
  FROM (
    SELECT h.rating_before, h.rating_after,
           ROW_NUMBER() OVER (ORDER BY h.id DESC) AS rn,
           COUNT(*) OVER () AS cnt
    FROM (
      SELECT id, rating_before, rating_after FROM rating_history
      WHERE user_id = ratings.user_id AND variant = ratings.variant
      ORDER BY id DESC LIMIT 12
    ) AS h
  ) AS w
), 0);
