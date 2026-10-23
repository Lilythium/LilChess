-- Checkpoints for replaying long games: the position (and the repetition keys that can still matter)
-- after every SNAPSHOT_INTERVAL-th ply, so a move only replays the plies since the last checkpoint.
-- move_id pins a checkpoint to the exact move row it was taken after; if a takeback retracts that ply
-- the active_moves join stops matching and the checkpoint is ignored.
CREATE TABLE game_snapshots (
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  ply INTEGER NOT NULL CHECK (ply >= 1),
  move_id INTEGER NOT NULL REFERENCES moves(id) ON DELETE CASCADE,
  fen TEXT NOT NULL,
  keys TEXT NOT NULL, -- newline-separated repetition keys, oldest first, last one is this position
  PRIMARY KEY (game_id, ply)
);
