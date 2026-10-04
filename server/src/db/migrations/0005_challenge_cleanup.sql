-- Challenges are ephemeral (<= 2 days), so rebuild empty rather than copy rows that might not fit the new rules.
DROP TABLE challenges;

CREATE TABLE challenges (
  id TEXT PRIMARY KEY,
  from_user INTEGER NOT NULL REFERENCES users(id),
  to_user INTEGER REFERENCES users(id),
  mode TEXT NOT NULL CHECK (mode IN ('live', 'correspondence')),
  initial_ms INTEGER,
  increment_ms INTEGER CHECK (increment_ms IS NULL OR increment_ms >= 0),
  days_per_move INTEGER,
  color_pref TEXT CHECK (color_pref IS NULL OR color_pref IN ('white', 'black')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  is_link INTEGER NOT NULL DEFAULT 0 CHECK (is_link IN (0, 1)),
  CHECK (to_user IS NULL OR to_user <> from_user),
  CHECK (
    (mode = 'live' AND initial_ms IS NOT NULL AND initial_ms > 0 AND days_per_move IS NULL)
    OR (mode = 'correspondence' AND days_per_move IS NOT NULL AND days_per_move > 0 AND initial_ms IS NULL)
  )
);

-- At most one challenge per user per mode.
CREATE UNIQUE INDEX idx_challenges_one_per_mode ON challenges(from_user, mode);
CREATE INDEX idx_challenges_expires ON challenges(expires_at);

-- Lets the hourly purge of expired sessions use an index.
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
CREATE INDEX idx_sessions_user ON sessions(user_id);