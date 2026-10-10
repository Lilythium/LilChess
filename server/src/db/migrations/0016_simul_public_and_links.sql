-- Public simuls (the default) and per-simul invite links.

ALTER TABLE simuls ADD COLUMN is_public INTEGER NOT NULL DEFAULT 1 CHECK (is_public IN (0, 1));
-- Simuls that exist now were invitation-only; keep them that way. New simuls default to public.
UPDATE simuls SET is_public = 0;

-- SQLite can't add a UNIQUE column, so: add it, backfill, then index it.
ALTER TABLE simuls ADD COLUMN invite_code TEXT;
UPDATE simuls SET invite_code = lower(hex(randomblob(8)));
CREATE UNIQUE INDEX idx_simuls_invite_code ON simuls(invite_code);

-- The "open simuls" list on the Simuls page.
CREATE INDEX idx_simuls_public_open ON simuls(created_at DESC) WHERE status = 'open' AND is_public = 1;