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

/** Open and cancelled simuls are private to the host and the people invited; running and finished ones are public. */
export function canViewSimul(simulId: string, userId: number): boolean {
  const db = getDb();
  const simul = db.prepare(`SELECT host_id, status FROM simuls WHERE id = ?`).get(simulId) as
    | { host_id: number; status: string }
    | undefined;
  if (!simul) return false;
  if (simul.status === "running" || simul.status === "completed") return true;
  if (simul.host_id === userId) return true;
  return db.prepare(`SELECT 1 FROM simul_players WHERE simul_id = ? AND user_id = ?`).get(simulId, userId) !== undefined;
}