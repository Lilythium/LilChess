-- Simul² is one tournament containing one host-view simul per participant.
-- A board references a canonical tournament game rather than creating another game.
CREATE TABLE tournament_simuls (
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  host_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (tournament_id, host_id)
) WITHOUT ROWID;

CREATE TABLE tournament_simul_boards (
  tournament_id TEXT NOT NULL,
  host_id INTEGER NOT NULL,
  challenger_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  seat INTEGER NOT NULL CHECK (seat > 0),
  PRIMARY KEY (tournament_id, host_id, challenger_id),
  FOREIGN KEY (tournament_id, host_id)
    REFERENCES tournament_simuls(tournament_id, host_id) ON DELETE CASCADE,
  CHECK (host_id <> challenger_id)
) WITHOUT ROWID;

CREATE INDEX idx_tournament_simul_boards_game
  ON tournament_simul_boards(tournament_id, game_id);
CREATE INDEX idx_tournament_simul_boards_host
  ON tournament_simul_boards(tournament_id, host_id, seat);

-- Backfill existing Simul² tournaments without creating or changing games.
INSERT OR IGNORE INTO tournament_simuls (tournament_id, host_id, created_at)
SELECT t.id, p.user_id, COALESCE(t.started_at, t.created_at)
FROM tournaments t
JOIN tournament_participants p ON p.tournament_id = t.id
WHERE t.format = 'simul2' AND t.status IN ('running', 'completed');

INSERT OR IGNORE INTO tournament_simul_boards
  (tournament_id, host_id, challenger_id, game_id, seat)
SELECT tournament_id, host_id, challenger_id, game_id,
       ROW_NUMBER() OVER (PARTITION BY tournament_id, host_id ORDER BY board_number)
FROM (
  SELECT p.tournament_id, p.white_id AS host_id, p.black_id AS challenger_id,
         p.game_id, p.board_number
  FROM tournament_pairings p
  JOIN tournaments t ON t.id = p.tournament_id
  WHERE t.format = 'simul2' AND p.game_id IS NOT NULL
  UNION ALL
  SELECT p.tournament_id, p.black_id AS host_id, p.white_id AS challenger_id,
         p.game_id, p.board_number
  FROM tournament_pairings p
  JOIN tournaments t ON t.id = p.tournament_id
  WHERE t.format = 'simul2' AND p.game_id IS NOT NULL
);

ALTER TABLE tournaments
  ADD COLUMN white_extra_ms INTEGER NOT NULL DEFAULT 30000
  CHECK (white_extra_ms BETWEEN 0 AND 600000);