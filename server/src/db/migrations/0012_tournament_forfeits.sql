-- A player who aborts a tournament game (or never makes their first move) forfeits it and is paused:
-- no new games are created for them until they choose to resume.
ALTER TABLE tournament_participants ADD COLUMN paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0, 1));

-- The user who forfeited this pairing. Set when its game was aborted, or when no game was created
-- because that player was paused. The game row itself stays 'aborted' with no result.
ALTER TABLE tournament_pairings ADD COLUMN forfeit_by INTEGER REFERENCES users(id);

-- Both players were paused: nothing was played and nobody scores.
ALTER TABLE tournament_pairings ADD COLUMN voided INTEGER NOT NULL DEFAULT 0 CHECK (voided IN (0, 1));