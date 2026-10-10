-- v2 phase 8: simultaneous exhibitions.
-- A simul has a host and invited players; starting it creates one ordinary game per accepted player.
-- NOTE: the trigger below lives on `games`. A future migration that rebuilds `games` must recreate it.

CREATE TABLE simuls (
  id TEXT PRIMARY KEY,
  host_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'running', 'completed', 'cancelled')),
  mode TEXT NOT NULL CHECK (mode IN ('live', 'correspondence')),
  initial_ms INTEGER,
  increment_ms INTEGER,
  days_per_move INTEGER,
  host_extra_ms INTEGER NOT NULL DEFAULT 0 CHECK (host_extra_ms >= 0),
  variant TEXT NOT NULL DEFAULT 'standard' CHECK (variant IN ('standard', 'chess960')),
  host_color TEXT NOT NULL DEFAULT 'white' CHECK (host_color IN ('white', 'black', 'alternate')),
  max_players INTEGER NOT NULL CHECK (max_players BETWEEN 2 AND 20),
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  ended_at INTEGER,
  CHECK (
    (mode = 'live' AND initial_ms > 0 AND increment_ms >= 0 AND days_per_move IS NULL) OR
    (mode = 'correspondence' AND days_per_move > 0 AND initial_ms IS NULL AND increment_ms IS NULL)
  ),
  -- Live games abort when the side to move hasn't moved within 30 s of the opponent's first move,
  -- so a live host playing Black would lose boards. Extra host time is a live-only idea.
  CHECK (mode = 'correspondence' OR (host_color = 'white')),
  CHECK (mode = 'live' OR host_extra_ms = 0)
);

CREATE INDEX idx_simuls_status_created ON simuls(status, created_at DESC);
-- One open-or-running simul per host.
CREATE UNIQUE INDEX idx_simuls_one_active_per_host ON simuls(host_id) WHERE status IN ('open', 'running');

CREATE TABLE simul_players (
  simul_id TEXT NOT NULL REFERENCES simuls(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'accepted', 'declined')),
  seat INTEGER CHECK (seat IS NULL OR seat > 0),
  game_id TEXT UNIQUE REFERENCES games(id) ON DELETE CASCADE,
  invited_at INTEGER NOT NULL,
  responded_at INTEGER,
  PRIMARY KEY (simul_id, user_id),
  CHECK (game_id IS NULL OR status = 'accepted')
) WITHOUT ROWID;

CREATE INDEX idx_simul_players_user ON simul_players(user_id, status);

-- Same pattern as tournaments_complete_after_game: the simul ends in the transaction that ends its last game.
CREATE TRIGGER simuls_complete_after_game
AFTER UPDATE OF status ON games
WHEN NEW.status <> 'started'
BEGIN
  UPDATE simuls SET status = 'completed', ended_at = NEW.ended_at
  WHERE status = 'running'
    AND id IN (SELECT simul_id FROM simul_players WHERE game_id = NEW.id)
    AND NOT EXISTS (
      SELECT 1 FROM simul_players sp JOIN games g ON g.id = sp.game_id
      WHERE sp.simul_id = simuls.id AND g.status = 'started'
    );
END;