-- Keep every played move, including moves later retracted by a takeback.
CREATE TABLE moves_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL REFERENCES games(id),
  ply INTEGER NOT NULL CHECK (ply >= 1),
  uci TEXT NOT NULL CHECK (
    uci GLOB '[a-h][1-8][a-h][1-8]' OR uci GLOB '[a-h][1-8][a-h][1-8][qrbnk]'
    OR uci GLOB '[PNBRQ]@[a-h][1-8]'
  ),
  san TEXT NOT NULL CHECK (san <> ''),
  played_at INTEGER NOT NULL DEFAULT 0
);

INSERT INTO moves_new (game_id, ply, uci, san, played_at)
SELECT m.game_id, m.ply, m.uci, m.san, g.created_at
FROM moves m
JOIN games g ON g.id = m.game_id;

DROP TABLE moves;
ALTER TABLE moves_new RENAME TO moves;
CREATE INDEX idx_moves_game_ply_id ON moves(game_id, ply, id);