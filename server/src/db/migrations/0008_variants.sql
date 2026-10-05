-- Games already store `variant`; challenges need it so it can carry over on accept.
ALTER TABLE challenges ADD COLUMN variant TEXT NOT NULL DEFAULT 'standard'
  CHECK (variant IN ('standard', 'chess960'));