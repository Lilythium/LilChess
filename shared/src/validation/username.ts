// This is the single definition of "canonical username" for client and server.
export function normalizeUsername(name: string): string {
  return name.trim().replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/** What a deleted account's username becomes: `deleted_` and 8 hex digits. Nobody can register a name of this shape. */
const DELETED_USERNAME = /^deleted_[0-9a-f]{8}$/;

export function isDeletedUsername(name: string): boolean {
  return DELETED_USERNAME.test(normalizeUsername(name));
}
