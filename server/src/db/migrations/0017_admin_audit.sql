CREATE TABLE admin_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_admin_audit_created ON admin_audit(created_at DESC);