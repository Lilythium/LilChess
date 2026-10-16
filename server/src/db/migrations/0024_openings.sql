-- v2.2: opening explorer built from finished games played on this server.
-- opening_moves counts, for every position reached in the first plies of a game, how often each move was played
-- and how those games ended. opening_games remembers which games are already counted, so counting is idempotent
-- (safe to backfill, and safe if a game is persisted twice).
CREATE TABLE opening_games (
  game_id TEXT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE
) WITHOUT ROWID;

CREATE TABLE opening_moves (
  variant TEXT NOT NULL,
  position_key TEXT NOT NULL,   -- placement + side to move + castling + en passant (+ Three-check counters)
  uci TEXT NOT NULL,
  white INTEGER NOT NULL DEFAULT 0 CHECK (white >= 0),
  draws INTEGER NOT NULL DEFAULT 0 CHECK (draws >= 0),
  black INTEGER NOT NULL DEFAULT 0 CHECK (black >= 0),
  PRIMARY KEY (variant, position_key, uci)
) WITHOUT ROWID;
