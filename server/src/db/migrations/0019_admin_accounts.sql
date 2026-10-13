-- Admin account management: disabled accounts and database-backed registration invite codes.

-- NULL = active. A disabled account cannot log in, has no sessions, and is left out of the leaderboard.
ALTER TABLE users ADD COLUMN disabled_at INTEGER;

-- Codes admins hand out when REGISTRATION=invite. The INVITE_CODE env var keeps working alongside these.
CREATE TABLE registration_invites (
  code TEXT PRIMARY KEY CHECK (length(code) BETWEEN 8 AND 32),
  note TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,                                   -- NULL = never expires
  max_uses INTEGER NOT NULL DEFAULT 1 CHECK (max_uses BETWEEN 1 AND 1000),
  uses INTEGER NOT NULL DEFAULT 0 CHECK (uses >= 0 AND uses <= max_uses),
  revoked_at INTEGER
);