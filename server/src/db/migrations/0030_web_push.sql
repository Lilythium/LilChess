-- Web Push notifications (a third channel next to email and Discord).
-- One row per browser/device a user turned push on for. The endpoint is the push service's URL for that
-- browser; it is unique, so re-registering the same browser (even as a different user) replaces its row.
CREATE TABLE push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_push_subscriptions_user ON push_subscriptions(user_id);

-- Per-kind toggles, stored separately so each channel is switched independently (missing row = on).
CREATE TABLE notification_prefs_push (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  PRIMARY KEY (user_id, kind)
);

-- The server's VAPID key pair, generated on first use. It lives in the database (not an env var) so a
-- restored backup keeps the keys that existing subscriptions were created against. Single row.
CREATE TABLE push_vapid (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  public_key TEXT NOT NULL,
  private_key TEXT NOT NULL
);
