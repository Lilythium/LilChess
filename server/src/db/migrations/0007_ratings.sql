-- Ratings (v2 phase 1). Existing games stay unrated.
ALTER TABLE games ADD COLUMN rated INTEGER NOT NULL DEFAULT 0 CHECK (rated IN (0, 1));
ALTER TABLE challenges ADD COLUMN rated INTEGER NOT NULL DEFAULT 0 CHECK (rated IN (0, 1));

CREATE TABLE ratings (
  user_id INTEGER NOT NULL REFERENCES users(id),
  variant TEXT NOT NULL,
  rating REAL NOT NULL,
  rd REAL NOT NULL CHECK (rd > 0),
  volatility REAL NOT NULL CHECK (volatility > 0),
  games INTEGER NOT NULL DEFAULT 0 CHECK (games >= 0),
  last_game_at INTEGER,
  PRIMARY KEY (user_id, variant)
);
-- leaderboard (v2 phase 6)
CREATE INDEX idx_ratings_variant_rating ON ratings(variant, rating DESC);

-- One row per player per rated game. UNIQUE(game_id, user_id) makes double-applying impossible.
CREATE TABLE rating_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL REFERENCES games(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  variant TEXT NOT NULL,
  opponent_id INTEGER NOT NULL REFERENCES users(id),
  opponent_rating REAL NOT NULL,
  score REAL NOT NULL CHECK (score IN (0, 0.5, 1)),
  rating_before REAL NOT NULL,
  rd_before REAL NOT NULL,
  rating_after REAL NOT NULL,
  rd_after REAL NOT NULL,
  volatility_after REAL NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (game_id, user_id)
);
CREATE INDEX idx_rating_history_user ON rating_history(user_id, variant, id);