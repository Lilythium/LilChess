DROP TRIGGER IF EXISTS tournaments_complete_after_game;

ALTER TABLE tournaments ADD COLUMN description TEXT;
ALTER TABLE tournaments ADD COLUMN rated INTEGER NOT NULL DEFAULT 0 CHECK (rated IN (0, 1));
ALTER TABLE tournaments ADD COLUMN starts_at INTEGER;
ALTER TABLE tournaments ADD COLUMN ends_at INTEGER;
ALTER TABLE tournaments ADD COLUMN current_round INTEGER NOT NULL DEFAULT 1 CHECK (current_round > 0);

CREATE TABLE tournament_pairings (
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL CHECK (round_number > 0),
  board_number INTEGER NOT NULL CHECK (board_number > 0),
  white_id INTEGER NOT NULL REFERENCES users(id),
  black_id INTEGER NOT NULL REFERENCES users(id),
  game_id TEXT UNIQUE REFERENCES games(id) ON DELETE CASCADE,
  PRIMARY KEY (tournament_id, round_number, board_number),
  CHECK (white_id <> black_id)
) WITHOUT ROWID;

INSERT INTO tournament_pairings (tournament_id, round_number, board_number, white_id, black_id, game_id)
SELECT tg.tournament_id, tg.round_number,
       ROW_NUMBER() OVER (PARTITION BY tg.tournament_id, tg.round_number ORDER BY tg.game_id),
       g.white_id, g.black_id, tg.game_id
FROM tournament_games tg JOIN games g ON g.id = tg.game_id;

DROP TABLE tournament_games;

CREATE INDEX idx_tournament_pairings_games ON tournament_pairings(tournament_id, round_number, game_id);

UPDATE tournaments SET status = 'completed'
WHERE status = 'running'
  AND NOT EXISTS (
    SELECT 1 FROM tournament_pairings p JOIN games g ON g.id = p.game_id
    WHERE p.tournament_id = tournaments.id AND g.status = 'started'
  );