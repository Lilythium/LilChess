CREATE TABLE tournaments (
  id TEXT PRIMARY KEY,
  created_by INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'running', 'completed', 'cancelled')),
  format TEXT NOT NULL DEFAULT 'round_robin' CHECK (format = 'round_robin'),
  mode TEXT NOT NULL CHECK (mode IN ('live', 'correspondence')),
  initial_ms INTEGER,
  increment_ms INTEGER,
  days_per_move INTEGER,
  variant TEXT NOT NULL DEFAULT 'standard' CHECK (variant IN ('standard', 'chess960')),
  max_players INTEGER NOT NULL CHECK (max_players BETWEEN 2 AND 16),
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  CHECK (
    (mode = 'live' AND initial_ms > 0 AND increment_ms >= 0 AND days_per_move IS NULL) OR
    (mode = 'correspondence' AND days_per_move > 0 AND initial_ms IS NULL AND increment_ms IS NULL)
  )
);

CREATE INDEX idx_tournaments_status_created ON tournaments(status, created_at DESC);

CREATE TABLE tournament_participants (
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (tournament_id, user_id)
) WITHOUT ROWID;

CREATE TABLE tournament_games (
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  game_id TEXT NOT NULL UNIQUE REFERENCES games(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL CHECK (round_number > 0),
  PRIMARY KEY (tournament_id, game_id)
) WITHOUT ROWID;

CREATE TRIGGER tournaments_complete_after_game
AFTER UPDATE OF status ON games
WHEN NEW.status <> 'started'
BEGIN
  UPDATE tournaments SET status = 'completed'
  WHERE status = 'running'
    AND id IN (SELECT tournament_id FROM tournament_games WHERE game_id = NEW.id)
    AND NOT EXISTS (
      SELECT 1 FROM tournament_games tg JOIN games g ON g.id = tg.game_id
      WHERE tg.tournament_id = tournaments.id AND g.status = 'started'
    );
END;