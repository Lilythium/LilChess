import { getDb } from "../db/connection.js";

export function simulIdForGame(gameId: string): string | undefined {
  const row = getDb().prepare(`SELECT simul_id FROM simul_players WHERE game_id = ?`).get(gameId) as
    | { simul_id: string }
    | undefined;
  return row?.simul_id;
}

export interface SimulInfo { id: string; name: string; hostId: number; hostName: string }

export function simulInfoForGame(gameId: string): SimulInfo | null {
  const row = getDb().prepare(`
    SELECT s.id, s.name, s.host_id AS hostId, u.username AS hostName
    FROM simul_players sp
    JOIN simuls s ON s.id = sp.simul_id
    JOIN users u ON u.id = s.host_id
    WHERE sp.game_id = ?
  `).get(gameId) as SimulInfo | undefined;
  return row ?? null;
}

/**
 * Public simuls can be opened by anyone while they are open; private ones only by the host and the people
 * invited. Running and finished simuls are public either way.
 */
export function canViewSimul(simulId: string, userId: number): boolean {
  const db = getDb();
  const simul = db.prepare(`SELECT host_id, status, is_public FROM simuls WHERE id = ?`).get(simulId) as
    | { host_id: number; status: string; is_public: number }
    | undefined;
  if (!simul) return false;
  if (simul.status === "running" || simul.status === "completed") return true;
  if (simul.host_id === userId) return true;
  if (simul.status === "open" && simul.is_public === 1) return true;
  return db.prepare(`SELECT 1 FROM simul_players WHERE simul_id = ? AND user_id = ?`).get(simulId, userId) !== undefined;
}