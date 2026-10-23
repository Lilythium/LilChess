CREATE TABLE active_moves (
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  ply INTEGER NOT NULL CHECK (ply >= 1),
  move_id INTEGER NOT NULL UNIQUE REFERENCES moves(id) ON DELETE CASCADE,
  PRIMARY KEY (game_id, ply)
);

INSERT INTO active_moves (game_id, ply, move_id)
SELECT m.game_id, m.ply, m.id
FROM moves m
JOIN games g ON g.id = m.game_id
WHERE m.ply <= g.ply
  AND m.id = (
    SELECT MAX(previous.id) FROM moves previous
    WHERE previous.game_id = m.game_id AND previous.ply = m.ply
  );

CREATE TRIGGER moves_set_active AFTER INSERT ON moves
BEGIN
  INSERT INTO active_moves (game_id, ply, move_id)
  VALUES (NEW.game_id, NEW.ply, NEW.id)
  ON CONFLICT (game_id, ply) DO UPDATE SET move_id = NEW.id;
END;