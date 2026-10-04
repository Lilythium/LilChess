-- Rebuilds games and moves with CHECK constraints (SQLite can't ALTER them in) and adds games.fen / games.last_move.
-- The migration runner turns foreign keys off around this file.

-- Repair anything older code could have left inconsistent, so the copy can't trip the new CHECKs.
UPDATE games SET draw_offered_by = NULL, takeback_offered_by = NULL WHERE status <> 'started';
UPDATE games SET result = NULL, termination = 'abort' WHERE status = 'aborted';
UPDATE games SET ended_at = COALESCE(ended_at, created_at) WHERE status <> 'started';
UPDATE games SET ended_at = NULL WHERE status = 'started';
UPDATE games SET white_ms = MAX(white_ms, 0), black_ms = MAX(black_ms, 0);
UPDATE games SET increment_ms = 0 WHERE mode = 'live' AND increment_ms IS NULL;
UPDATE games SET days_per_move = NULL WHERE mode = 'live';
UPDATE games SET initial_ms = NULL, increment_ms = NULL WHERE mode = 'correspondence';

CREATE TABLE games_new (
  id TEXT PRIMARY KEY,
  white_id INTEGER NOT NULL REFERENCES users(id),
  black_id INTEGER NOT NULL REFERENCES users(id),
  variant TEXT NOT NULL DEFAULT 'standard',
  mode TEXT NOT NULL CHECK (mode IN ('live', 'correspondence')),
  initial_ms INTEGER,
  increment_ms INTEGER,
  days_per_move INTEGER,
  status TEXT NOT NULL CHECK (status IN ('started', 'finished', 'aborted')),
  result TEXT CHECK (result IN ('1-0', '0-1', '1/2-1/2')),
  termination TEXT CHECK (termination IN (
    'checkmate', 'stalemate', 'insufficient_material', 'fifty_move', 'repetition',
    'resignation', 'agreement', 'timeout', 'abort')),
  initial_fen TEXT NOT NULL,
  fen TEXT,                -- current position; filled by backfillPositions for old rows
  last_move TEXT,          -- UCI of the latest move
  ply INTEGER NOT NULL DEFAULT 0 CHECK (ply >= 0),
  white_ms INTEGER NOT NULL CHECK (white_ms >= 0),
  black_ms INTEGER NOT NULL CHECK (black_ms >= 0),
  turn_started_at INTEGER NOT NULL,
  deadline_at INTEGER NOT NULL,
  draw_offered_by TEXT CHECK (draw_offered_by IN ('white', 'black')),
  takeback_offered_by TEXT CHECK (takeback_offered_by IN ('white', 'black')),
  created_at INTEGER NOT NULL,
  ended_at INTEGER,
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
  id, white_id, black_id, variant, mode, initial_ms, increment_ms, days_per_move,
  status, result, termination, initial_fen, ply, white_ms, black_ms,
  turn_started_at, deadline_at, draw_offered_by, takeback_offered_by, created_at, ended_at
)
SELECT
  id, white_id, black_id, variant, mode, initial_ms, increment_ms, days_per_move,
  status, result, termination, initial_fen, ply, white_ms, black_ms,
  turn_started_at, deadline_at, draw_offered_by, takeback_offered_by, created_at, ended_at
FROM games;

-- moves
UPDATE moves SET ply = 1 WHERE ply = 0; -- Older versions stored the first move as ply 0.
CREATE TABLE moves_new (
  game_id TEXT NOT NULL REFERENCES games(id),
  ply INTEGER NOT NULL CHECK (ply >= 1),
  uci TEXT NOT NULL CHECK (uci GLOB '[a-h][1-8][a-h][1-8]' OR uci GLOB '[a-h][1-8][a-h][1-8][qrbn]'),
  san TEXT NOT NULL CHECK (san <> ''),
  PRIMARY KEY (game_id, ply)
);

INSERT INTO moves_new (game_id, ply, uci, san)
SELECT m.game_id, m.ply, m.uci, m.san FROM moves m
WHERE EXISTS (SELECT 1 FROM games g WHERE g.id = m.game_id);

DROP TABLE moves;
DROP TABLE games;
ALTER TABLE games_new RENAME TO games;
ALTER TABLE moves_new RENAME TO moves;

CREATE INDEX idx_games_status_deadline ON games(status, deadline_at);
CREATE INDEX idx_games_white ON games(white_id);
CREATE INDEX idx_games_black ON games(black_id);