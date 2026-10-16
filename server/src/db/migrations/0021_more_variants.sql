-- v2.2: Crazyhouse, Three-check and Antichess.
-- SQLite can't edit a CHECK in place, so each table whose constraint lists variants, terminations or the UCI
-- shape is rebuilt (create new, copy, drop old, rename). The migration runner turns foreign keys off for us.

-- ---- games: two new terminations ------------------------------------------------------------------------
CREATE TABLE games_new (
  id TEXT PRIMARY KEY,
  white_id INTEGER NOT NULL REFERENCES users(id),
  black_id INTEGER NOT NULL REFERENCES users(id),
  variant TEXT NOT NULL DEFAULT 'standard'
    CHECK (variant IN ('standard', 'chess960', 'crazyhouse', 'threecheck', 'antichess')),
  mode TEXT NOT NULL CHECK (mode IN ('live', 'correspondence')),
  initial_ms INTEGER,
  increment_ms INTEGER,
  days_per_move INTEGER,
  status TEXT NOT NULL CHECK (status IN ('started', 'finished', 'aborted')),
  result TEXT CHECK (result IN ('1-0', '0-1', '1/2-1/2')),
  termination TEXT CHECK (termination IN (
    'checkmate', 'stalemate', 'insufficient_material', 'fifty_move', 'repetition',
    'three_check', 'variant_end',
    'resignation', 'agreement', 'timeout', 'abort')),
  initial_fen TEXT NOT NULL,
  fen TEXT,
  last_move TEXT,
  ply INTEGER NOT NULL DEFAULT 0 CHECK (ply >= 0),
  white_ms INTEGER NOT NULL CHECK (white_ms >= 0),
  black_ms INTEGER NOT NULL CHECK (black_ms >= 0),
  turn_started_at INTEGER NOT NULL,
  deadline_at INTEGER NOT NULL,
  draw_offered_by TEXT CHECK (draw_offered_by IN ('white', 'black')),
  takeback_offered_by TEXT CHECK (takeback_offered_by IN ('white', 'black')),
  created_at INTEGER NOT NULL,
  ended_at INTEGER,
  rated INTEGER NOT NULL DEFAULT 0 CHECK (rated IN (0, 1)),
  CHECK (white_id <> black_id),
  CHECK (
    (mode = 'live' AND initial_ms IS NOT NULL AND initial_ms > 0
       AND increment_ms IS NOT NULL AND increment_ms >= 0 AND days_per_move IS NULL)
    OR (mode = 'correspondence' AND days_per_move IS NOT NULL AND days_per_move > 0
       AND initial_ms IS NULL AND increment_ms IS NULL)
  ),
  CHECK (
    (status = 'started'  AND result IS NULL AND termination IS NULL AND ended_at IS NULL)
    OR (status = 'finished' AND result IS NOT NULL AND termination IS NOT NULL
        AND termination <> 'abort' AND ended_at IS NOT NULL)
    OR (status = 'aborted'  AND result IS NULL AND termination = 'abort' AND ended_at IS NOT NULL)
  ),
  CHECK (status = 'started' OR (draw_offered_by IS NULL AND takeback_offered_by IS NULL))
);
INSERT INTO games_new (
  id, white_id, black_id, variant, mode, initial_ms, increment_ms, days_per_move, status, result, termination,
  initial_fen, fen, last_move, ply, white_ms, black_ms, turn_started_at, deadline_at, draw_offered_by,
  takeback_offered_by, created_at, ended_at, rated
) SELECT
  id, white_id, black_id, variant, mode, initial_ms, increment_ms, days_per_move, status, result, termination,
  initial_fen, fen, last_move, ply, white_ms, black_ms, turn_started_at, deadline_at, draw_offered_by,
  takeback_offered_by, created_at, ended_at, rated
FROM games;
DROP TABLE games;
ALTER TABLE games_new RENAME TO games;
CREATE INDEX idx_games_status_deadline ON games(status, deadline_at);
CREATE INDEX idx_games_white ON games(white_id);
CREATE INDEX idx_games_black ON games(black_id);
-- ---- moves: Crazyhouse drops ("N@f3") and Antichess king promotion ("a7a8k") -----------------------------
CREATE TABLE moves_new (
  game_id TEXT NOT NULL REFERENCES games(id),
  ply INTEGER NOT NULL CHECK (ply >= 1),
  uci TEXT NOT NULL CHECK (
    uci GLOB '[a-h][1-8][a-h][1-8]' OR uci GLOB '[a-h][1-8][a-h][1-8][qrbnk]'
    OR uci GLOB '[PNBRQ]@[a-h][1-8]'
  ),
  san TEXT NOT NULL CHECK (san <> ''),
  PRIMARY KEY (game_id, ply)
);
INSERT INTO moves_new (game_id, ply, uci, san) SELECT game_id, ply, uci, san FROM moves;
DROP TABLE moves;
ALTER TABLE moves_new RENAME TO moves;

-- ---- challenges ----------------------------------------------------------------------------------------
CREATE TABLE challenges_new (
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
  rated INTEGER NOT NULL DEFAULT 0 CHECK (rated IN (0, 1)),
  variant TEXT NOT NULL DEFAULT 'standard'
    CHECK (variant IN ('standard', 'chess960', 'crazyhouse', 'threecheck', 'antichess')),
  CHECK (to_user IS NULL OR to_user <> from_user),
  CHECK (
    (mode = 'live' AND initial_ms IS NOT NULL AND initial_ms > 0 AND days_per_move IS NULL)
    OR (mode = 'correspondence' AND days_per_move IS NOT NULL AND days_per_move > 0 AND initial_ms IS NULL)
  )
);
INSERT INTO challenges_new (
  id, from_user, to_user, mode, initial_ms, increment_ms, days_per_move, color_pref, created_at, expires_at,
  is_link, rated, variant
) SELECT
  id, from_user, to_user, mode, initial_ms, increment_ms, days_per_move, color_pref, created_at, expires_at,
  is_link, rated, variant
FROM challenges;
DROP TABLE challenges;
ALTER TABLE challenges_new RENAME TO challenges;
CREATE UNIQUE INDEX idx_challenges_one_per_mode ON challenges(from_user, mode);
CREATE INDEX idx_challenges_expires ON challenges(expires_at);

-- ---- tournaments ---------------------------------------------------------------------------------------
CREATE TABLE tournaments_new (
  id TEXT PRIMARY KEY,
  created_by INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'running', 'completed', 'cancelled')),
  format TEXT NOT NULL DEFAULT 'round_robin' CHECK (format IN ('round_robin', 'swiss', 'knockout', 'arena', 'simul2')),
  mode TEXT NOT NULL CHECK (mode IN ('live', 'correspondence')),
  initial_ms INTEGER,
  increment_ms INTEGER,
  days_per_move INTEGER,
  variant TEXT NOT NULL DEFAULT 'standard'
    CHECK (variant IN ('standard', 'chess960', 'crazyhouse', 'threecheck', 'antichess')),
  rated INTEGER NOT NULL DEFAULT 0 CHECK (rated IN (0, 1)),
  max_players INTEGER NOT NULL CHECK (max_players BETWEEN 2 AND 64),
  rounds INTEGER CHECK (rounds IS NULL OR rounds BETWEEN 1 AND 63),
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms > 0),
  streak_bonus INTEGER NOT NULL DEFAULT 1 CHECK (streak_bonus IN (0, 1)),
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  starts_at INTEGER,
  ends_at INTEGER,
  current_round INTEGER NOT NULL DEFAULT 1 CHECK (current_round > 0),
  CHECK (
    (mode = 'live' AND initial_ms > 0 AND increment_ms >= 0 AND days_per_move IS NULL) OR
    (mode = 'correspondence' AND days_per_move > 0 AND initial_ms IS NULL AND increment_ms IS NULL)
  ),
  CHECK (format <> 'arena' OR (mode = 'live' AND duration_ms IS NOT NULL AND rounds IS NULL)),
  CHECK (format = 'arena' OR duration_ms IS NULL)
);
INSERT INTO tournaments_new SELECT * FROM tournaments;
DROP TABLE tournaments;
ALTER TABLE tournaments_new RENAME TO tournaments;
CREATE INDEX idx_tournaments_status_created ON tournaments(status, created_at DESC);

-- ---- simuls --------------------------------------------------------------------------------------------
CREATE TABLE simuls_new (
  id TEXT PRIMARY KEY,
  host_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'running', 'completed', 'cancelled')),
  mode TEXT NOT NULL CHECK (mode IN ('live', 'correspondence')),
  initial_ms INTEGER,
  increment_ms INTEGER,
  days_per_move INTEGER,
  host_extra_ms INTEGER NOT NULL DEFAULT 0 CHECK (host_extra_ms >= 0),
  variant TEXT NOT NULL DEFAULT 'standard'
    CHECK (variant IN ('standard', 'chess960', 'crazyhouse', 'threecheck', 'antichess')),
  host_color TEXT NOT NULL DEFAULT 'white' CHECK (host_color IN ('white', 'black', 'alternate')),
  max_players INTEGER NOT NULL CHECK (max_players BETWEEN 2 AND 20),
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  ended_at INTEGER,
  is_public INTEGER NOT NULL DEFAULT 1 CHECK (is_public IN (0, 1)),
  invite_code TEXT,
  CHECK (
    (mode = 'live' AND initial_ms > 0 AND increment_ms >= 0 AND days_per_move IS NULL) OR
    (mode = 'correspondence' AND days_per_move > 0 AND initial_ms IS NULL AND increment_ms IS NULL)
  ),
  CHECK (mode = 'correspondence' OR (host_color = 'white')),
  CHECK (mode = 'live' OR host_extra_ms = 0)
);
INSERT INTO simuls_new (
  id, host_id, name, status, mode, initial_ms, increment_ms, days_per_move, host_extra_ms, variant, host_color,
  max_players, created_at, started_at, ended_at, is_public, invite_code
) SELECT
  id, host_id, name, status, mode, initial_ms, increment_ms, days_per_move, host_extra_ms, variant, host_color,
  max_players, created_at, started_at, ended_at, is_public, invite_code
FROM simuls;
DROP TABLE simuls;
ALTER TABLE simuls_new RENAME TO simuls;
CREATE INDEX idx_simuls_status_created ON simuls(status, created_at DESC);
CREATE UNIQUE INDEX idx_simuls_one_active_per_host ON simuls(host_id) WHERE status IN ('open', 'running');
CREATE UNIQUE INDEX idx_simuls_invite_code ON simuls(invite_code);
CREATE INDEX idx_simuls_public_open ON simuls(created_at DESC) WHERE status = 'open' AND is_public = 1;

-- Recreated last: the trigger on games names the simuls table, so it can only exist while simuls does.
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
