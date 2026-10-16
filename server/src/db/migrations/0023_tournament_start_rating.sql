-- v2.2 (Simul2): performance rating needs each player's rating as it was when the tournament started,
-- not their rating after the games have already moved it.
ALTER TABLE tournament_participants ADD COLUMN start_rating INTEGER;
