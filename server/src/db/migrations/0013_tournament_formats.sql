-- v2 phase 5: swiss, knockout and arena tournaments.
-- Rebuilds tournaments (format CHECK, larger fields, new columns) and tournament_pairings (byes, knockout legs).
-- The migration runner turns foreign keys off around this file.

CREATE TABLE tournaments_new (
  id TEXT PRIMARY KEY,
  created_by INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'running', 'completed', 'cancelled')),
  format TEXT NOT NULL DEFAULT 'round_robin' CHECK (format IN ('round_robin', 'swiss', 'knockout', 'arena')),
  mode TEXT NOT NULL CHECK (mode IN ('live', 'correspondence')),
  initial_ms INTEGER,
  increment_ms INTEGER,
  days_per_move INTEGER,
  variant TEXT NOT NULL DEFAULT 'standard' CHECK (variant IN ('standard', 'chess960')),
  rated INTEGER NOT NULL DEFAULT 0 CHECK (rated IN (0, 1)),
  max_players INTEGER NOT NULL CHECK (max_players BETWEEN 2 AND 64),
  -- swiss: requested rounds (null = default); set to the real total when the tournament starts.
  -- round robin / knockout: total rounds, set at start. arena: always null.
  rounds INTEGER CHECK (rounds IS NULL OR rounds BETWEEN 1 AND 63),
  -- arena only: how long it runs once started, and whether two wins in a row double the next game.
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

INSERT INTO tournaments_new (
  id, created_by, name, description, status, format, mode, initial_ms, increment_ms, days_per_move,
  variant, rated, max_players, created_at, started_at, starts_at, ends_at, current_round
)
SELECT
  id, created_by, name, description, status, format, mode, initial_ms, increment_ms, days_per_move,
  variant, rated, max_players, created_at, started_at, starts_at, ends_at, current_round
FROM tournaments;

-- Finished round robins know their length already; fill it in so the UI can show "round 2 of 3".
UPDATE tournaments_new SET rounds = (
  SELECT MAX(round_number) FROM tournament_pairings p WHERE p.tournament_id = tournaments_new.id
) WHERE status IN ('running', 'completed');

DROP TABLE tournaments;
ALTER TABLE tournaments_new RENAME TO tournaments;
CREATE INDEX idx_tournaments_status_created ON tournaments(status, created_at DESC);

-- Seed (1 = best) fixed when the tournament starts, by rating then join order. Late arena joiners are appended.
ALTER TABLE tournament_participants ADD COLUMN seed INTEGER CHECK (seed IS NULL OR seed > 0);

-- One row per game, bye, or forfeited/voided slot.
--   bye:          is_bye = 1, white_id is the player who sits out, black_id and game_id are NULL.
--   knockout:     match_number is the bracket slot inside the round; leg > 1 are tiebreak replays.
--   arena:        round_number is always 1 and board_number counts games in creation order.
CREATE TABLE tournament_pairings_new (
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL CHECK (round_number > 0),
  board_number INTEGER NOT NULL CHECK (board_number > 0),
  white_id INTEGER NOT NULL REFERENCES users(id),
  black_id INTEGER REFERENCES users(id),
  game_id TEXT UNIQUE REFERENCES games(id) ON DELETE CASCADE,
  forfeit_by INTEGER REFERENCES users(id),
  voided INTEGER NOT NULL DEFAULT 0 CHECK (voided IN (0, 1)),
  is_bye INTEGER NOT NULL DEFAULT 0 CHECK (is_bye IN (0, 1)),
  match_number INTEGER CHECK (match_number IS NULL OR match_number > 0),
  leg INTEGER NOT NULL DEFAULT 1 CHECK (leg > 0),
  PRIMARY KEY (tournament_id, round_number, board_number),
  CHECK (
    (is_bye = 1 AND black_id IS NULL AND game_id IS NULL AND forfeit_by IS NULL AND voided = 0) OR
    (is_bye = 0 AND black_id IS NOT NULL AND white_id <> black_id)
  )
) WITHOUT ROWID;

INSERT INTO tournament_pairings_new (
  tournament_id, round_number, board_number, white_id, black_id, game_id, forfeit_by, voided
)
SELECT tournament_id, round_number, board_number, white_id, black_id, game_id, forfeit_by, voided
FROM tournament_pairings;

DROP TABLE tournament_pairings;
ALTER TABLE tournament_pairings_new RENAME TO tournament_pairings;
CREATE INDEX idx_tournament_pairings_games ON tournament_pairings(tournament_id, round_number, game_id);
