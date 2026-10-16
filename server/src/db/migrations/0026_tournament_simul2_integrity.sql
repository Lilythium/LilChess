CREATE TRIGGER tournament_simuls_require_participant_insert
BEFORE INSERT ON tournament_simuls
WHEN NOT EXISTS (
  SELECT 1 FROM tournament_participants p
  WHERE p.tournament_id = NEW.tournament_id AND p.user_id = NEW.host_id
)
BEGIN
  SELECT RAISE(ABORT, 'tournament simul host must be a participant');
END;

CREATE TRIGGER tournament_simuls_require_participant_update
BEFORE UPDATE OF tournament_id, host_id ON tournament_simuls
WHEN NOT EXISTS (
  SELECT 1 FROM tournament_participants p
  WHERE p.tournament_id = NEW.tournament_id AND p.user_id = NEW.host_id
)
BEGIN
  SELECT RAISE(ABORT, 'tournament simul host must be a participant');
END;

CREATE TRIGGER tournament_simul_boards_require_pairing_insert
BEFORE INSERT ON tournament_simul_boards
WHEN NOT EXISTS (
  SELECT 1 FROM tournament_pairings p
  WHERE p.tournament_id = NEW.tournament_id
    AND p.game_id = NEW.game_id
    AND (
      (p.white_id = NEW.host_id AND p.black_id = NEW.challenger_id)
      OR (p.black_id = NEW.host_id AND p.white_id = NEW.challenger_id)
    )
) OR NOT EXISTS (
  SELECT 1 FROM tournament_participants p
  WHERE p.tournament_id = NEW.tournament_id AND p.user_id = NEW.challenger_id
)
BEGIN
  SELECT RAISE(ABORT, 'tournament simul board must reference its pairing participants');
END;

CREATE TRIGGER tournament_simul_boards_require_pairing_update
BEFORE UPDATE OF tournament_id, host_id, challenger_id, game_id ON tournament_simul_boards
WHEN NOT EXISTS (
  SELECT 1 FROM tournament_pairings p
  WHERE p.tournament_id = NEW.tournament_id
    AND p.game_id = NEW.game_id
    AND (
      (p.white_id = NEW.host_id AND p.black_id = NEW.challenger_id)
      OR (p.black_id = NEW.host_id AND p.white_id = NEW.challenger_id)
    )
) OR NOT EXISTS (
  SELECT 1 FROM tournament_participants p
  WHERE p.tournament_id = NEW.tournament_id AND p.user_id = NEW.challenger_id
)
BEGIN
  SELECT RAISE(ABORT, 'tournament simul board must reference its pairing participants');
END;
