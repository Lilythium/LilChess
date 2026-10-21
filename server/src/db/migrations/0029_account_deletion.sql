-- Account deletion (self-service). A deleted account is kept as an anonymous tombstone row, because games, moves,
-- tournament pairings and similar records of OTHER people refer to it and must keep working. Everything personal
-- is removed from the row and from the tables that hold per-user data; see server/src/auth/deletion.ts.
ALTER TABLE users ADD COLUMN deleted_at INTEGER;
