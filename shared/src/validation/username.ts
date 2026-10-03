// This is the single definition of "canonical username" for client and server.
export function normalizeUsername(name: string): string {
  return name.trim().replace(/[A-Z]/g, (c) => c.toLowerCase());
}