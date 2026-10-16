-- v2.2: Discord notifications. Opt-in by giving a Discord user ID (unverified, like email).
-- Per-kind toggles mirror the email ones but are stored separately so each channel is switched independently.
ALTER TABLE users ADD COLUMN discord_id TEXT;

CREATE TABLE notification_prefs_discord (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  PRIMARY KEY (user_id, kind)
);
