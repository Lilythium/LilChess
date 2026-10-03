-- lower() only folds ASCII, matching normalizeUsername and the NOCASE collation.
UPDATE users SET username = lower(username);