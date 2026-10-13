import { getDb } from "../db/connection.js";

/**
 * Records something an administrator changed. Call it inside the same transaction as the change where
 * you can, so the log can't say something happened that didn't (or miss something that did).
 * Reads (viewing a page) are not recorded: they would bury the actions that matter.
 */
export function recordAudit(actorId: number, action: string, target: string, details: Record<string, unknown> = {}): void {
  getDb().prepare(`
    INSERT INTO admin_audit (actor_id, action, target, details, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(actorId, action, target, JSON.stringify(details), Date.now());
}