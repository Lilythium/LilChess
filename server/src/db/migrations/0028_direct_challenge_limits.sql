-- A sender may keep one direct challenge per recipient, independent of mode.
DELETE FROM challenges
WHERE to_user IS NOT NULL
  AND id <> (
    SELECT newer.id
    FROM challenges AS newer
    WHERE newer.from_user = challenges.from_user
      AND newer.to_user = challenges.to_user
    ORDER BY newer.created_at DESC, newer.id DESC
    LIMIT 1
  );

DROP INDEX idx_challenges_one_per_mode;
CREATE UNIQUE INDEX idx_challenges_one_per_mode
  ON challenges(from_user, mode)
  WHERE to_user IS NULL;
CREATE UNIQUE INDEX idx_challenges_one_per_recipient
  ON challenges(from_user, to_user)
  WHERE to_user IS NOT NULL;