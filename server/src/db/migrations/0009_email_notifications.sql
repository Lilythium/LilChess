ALTER TABLE users ADD COLUMN email TEXT;               -- stored lowercase, unverified, optional
ALTER TABLE users ADD COLUMN unsubscribe_token TEXT;   -- random; lets an email's link switch notifications off

CREATE INDEX idx_users_email ON users(email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX idx_users_unsubscribe ON users(unsubscribe_token) WHERE unsubscribe_token IS NOT NULL;

-- Only explicit choices are stored; a missing row means "on".
CREATE TABLE notification_prefs (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  PRIMARY KEY (user_id, kind)
);

-- One row per email we have decided to send. The primary key is the duplicate guard.
CREATE TABLE notification_log (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dedup_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, dedup_key)
) WITHOUT ROWID;
CREATE INDEX idx_notification_log_created ON notification_log(created_at);

CREATE TABLE password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_password_resets_user ON password_resets(user_id);
CREATE INDEX idx_password_resets_expires ON password_resets(expires_at);