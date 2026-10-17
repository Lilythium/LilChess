-- Indexes the opening positions reached by each counted game for the explorer's game list.
CREATE TABLE opening_positions (
  variant TEXT NOT NULL,
  position_key TEXT NOT NULL,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  PRIMARY KEY (variant, position_key, game_id)
) WITHOUT ROWID;

CREATE INDEX idx_opening_positions_game ON opening_positions(game_id);