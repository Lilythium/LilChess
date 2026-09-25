CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);

CREATE TABLE games (
  id TEXT PRIMARY KEY,
  white_id INTEGER NOT NULL REFERENCES users(id),
  black_id INTEGER NOT NULL REFERENCES users(id),
  variant TEXT NOT NULL DEFAULT 'standard',
  mode TEXT NOT NULL,                 -- 'live' | 'correspondence'
  initial_ms INTEGER,
  increment_ms INTEGER,
  days_per_move INTEGER,
  status TEXT NOT NULL,               -- 'started' | 'finished' | 'aborted'
  result TEXT,
  termination TEXT,
  initial_fen TEXT NOT NULL,
  ply INTEGER NOT NULL DEFAULT 0,
  white_ms INTEGER NOT NULL,
  black_ms INTEGER NOT NULL,
  turn_started_at INTEGER NOT NULL,
  deadline_at INTEGER NOT NULL,
  draw_offered_by TEXT,
  created_at INTEGER NOT NULL,
  ended_at INTEGER
);

CREATE INDEX idx_games_status_deadline ON games(status, deadline_at);
CREATE INDEX idx_games_white ON games(white_id);
CREATE INDEX idx_games_black ON games(black_id);

CREATE TABLE moves (
  game_id TEXT NOT NULL REFERENCES games(id),
  ply INTEGER NOT NULL,
  uci TEXT NOT NULL,
  san TEXT NOT NULL,
  PRIMARY KEY (game_id, ply)
);

CREATE TABLE challenges (
  id TEXT PRIMARY KEY,
  from_user INTEGER NOT NULL REFERENCES users(id),
  to_user INTEGER REFERENCES users(id),
  mode TEXT NOT NULL,
  initial_ms INTEGER,
  increment_ms INTEGER,
  days_per_move INTEGER,
  color_pref TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);