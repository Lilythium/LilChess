-- PGN imports live apart from real games. They belong to the user who imported them, name their
-- players as plain text, and have no clocks, ratings or accounts attached, so they can never show up
-- in head-to-head records, the timeout scheduler, leaderboards or another user's history.

CREATE TABLE imported_games (
  id TEXT PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  white_name TEXT NOT NULL CHECK (length(white_name) BETWEEN 1 AND 64),
  black_name TEXT NOT NULL CHECK (length(black_name) BETWEEN 1 AND 64),
  white_elo INTEGER CHECK (white_elo IS NULL OR white_elo BETWEEN 0 AND 9999),
  black_elo INTEGER CHECK (black_elo IS NULL OR black_elo BETWEEN 0 AND 9999),
  event TEXT,
  site TEXT,
  played_on TEXT,              -- PGN date as written, e.g. '2026.10.10' (parts may be '??')
  time_control TEXT,           -- PGN TimeControl tag as written, e.g. '60+0'
  termination TEXT,            -- PGN Termination tag as written, e.g. 'Time forfeit'
  variant TEXT NOT NULL DEFAULT 'standard' CHECK (variant IN ('standard', 'chess960')),
  result TEXT NOT NULL CHECK (result IN ('1-0', '0-1', '1/2-1/2', '*')),
  initial_fen TEXT NOT NULL,
  fen TEXT NOT NULL,           -- final position, for the thumbnail
  last_move TEXT,              -- UCI of the last move, for the thumbnail
  ply INTEGER NOT NULL CHECK (ply >= 0),
  content_hash TEXT NOT NULL,  -- importing the same game twice is a no-op
  created_at INTEGER NOT NULL,
  UNIQUE (owner_id, content_hash)
);

CREATE INDEX idx_imported_games_owner ON imported_games(owner_id, created_at DESC);

CREATE TABLE imported_moves (
  game_id TEXT NOT NULL REFERENCES imported_games(id) ON DELETE CASCADE,
  ply INTEGER NOT NULL CHECK (ply >= 1),
  uci TEXT NOT NULL CHECK (uci GLOB '[a-h][1-8][a-h][1-8]' OR uci GLOB '[a-h][1-8][a-h][1-8][qrbn]'),
  san TEXT NOT NULL CHECK (san <> ''),
  PRIMARY KEY (game_id, ply)
);