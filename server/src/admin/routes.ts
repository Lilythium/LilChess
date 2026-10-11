import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../db/connection.js";
import { terminateGameAsAdmin } from "../db/repositories/games.js";
import { requireAdmin } from "../auth/routes.js";
import { cancelTournament, startTournament, TournamentError } from "../tournaments/service.js";
import { notifyDeadlineChanged } from "../game/deadlineBus.js";
import { notifyTournamentStarting } from "../notifications/dispatch.js";
import { IdParams, parse } from "../validation.js";
import { purgeUnusedGuests } from "../maintenance.js";

const UserParams = z.object({ id: z.coerce.number().int().positive() });
const AdminBody = z.object({ isAdmin: z.boolean() });

function audit(actorId: number, action: string, target: string, details: Record<string, unknown> = {}) {
  getDb().prepare(`
    INSERT INTO admin_audit (actor_id, action, target, details, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(actorId, action, target, JSON.stringify(details), Date.now());
}

export async function adminRoutes(app: FastifyInstance) {
  app.addHook("onResponse", async (req, reply) => {
    if (!req.user?.is_admin || !req.url.startsWith("/api/admin/")) return;
    const target = req.url.split("?")[0] ?? req.url;
    try {
      audit(req.user.id, `${req.method} ${target}`, target, { statusCode: reply.statusCode });
    } catch (error) {
      req.log.error({ err: error, target }, "admin audit write failed");
    }
  });

  app.get("/api/admin/stats", { preHandler: requireAdmin }, async () => {
    const db = getDb();
    const counts = (table: string, where = "", params: unknown[] = []) =>
      (db.prepare(`SELECT COUNT(*) AS count FROM ${table} ${where}`).get(...params) as { count: number }).count;
    return {
      ok: true,
      stats: {
        users: counts("users"),
        registeredUsers: counts("users", "WHERE is_guest = 0"),
        guests: counts("users", "WHERE is_guest = 1"),
        activeGames: counts("games", "WHERE status = 'started'"),
        completedGames: counts("games", "WHERE status <> 'started'"),
        openInvitations: counts("challenges", "WHERE expires_at > ?", [Date.now()]),
        openTournaments: counts("tournaments", "WHERE status = 'open'"),
        runningTournaments: counts("tournaments", "WHERE status = 'running'"),
      },
    };
  });

  app.get("/api/admin/users", { preHandler: requireAdmin }, async () => ({
    ok: true,
    users: getDb().prepare(`
      SELECT u.id, u.username, u.created_at AS createdAt, u.is_admin AS isAdmin,
             u.is_guest AS isGuest, u.email,
             (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > ?) AS activeSessions,
             (SELECT COUNT(*) FROM games g WHERE g.white_id = u.id OR g.black_id = u.id) AS gameCount
      FROM users u ORDER BY u.created_at DESC LIMIT 500
    `).all(Date.now()),
  }));

  app.patch("/api/admin/users/:id", { preHandler: requireAdmin }, async (req, reply) => {
    const params = parse(UserParams, req.params, reply);
    const body = parse(AdminBody, req.body, reply);
    if (!params || !body) return reply;
    if (params.id === req.user!.id && !body.isAdmin) {
      return reply.code(409).send({ error: "You cannot remove your own administrator access" });
    }
    const db = getDb();
    const user = db.prepare(`SELECT id, is_guest FROM users WHERE id = ?`).get(params.id) as
      { id: number; is_guest: number } | undefined;
    if (!user) return reply.code(404).send({ error: "User not found" });
    if (body.isAdmin && user.is_guest) return reply.code(409).send({ error: "Guest accounts cannot be administrators" });
    if (!body.isAdmin) {
      const admins = db.prepare(`SELECT COUNT(*) AS count FROM users WHERE is_admin = 1`).get() as { count: number };
      if (admins.count <= 1) return reply.code(409).send({ error: "At least one administrator must remain" });
    }
    db.prepare(`UPDATE users SET is_admin = ? WHERE id = ?`).run(body.isAdmin ? 1 : 0, params.id);
    return { ok: true };
  });

  app.post("/api/admin/users/:id/revoke-sessions", { preHandler: requireAdmin }, async (req, reply) => {
    const params = parse(UserParams, req.params, reply);
    if (!params) return reply;
    if (params.id === req.user!.id) return reply.code(409).send({ error: "You cannot revoke your own session" });
    const result = getDb().prepare(`DELETE FROM sessions WHERE user_id = ?`).run(params.id);
    if (!getDb().prepare(`SELECT 1 FROM users WHERE id = ?`).get(params.id)) {
      return reply.code(404).send({ error: "User not found" });
    }
    return { ok: true, revoked: result.changes };
  });

  app.post("/api/admin/users/purge-guests", { preHandler: requireAdmin }, async () => ({
    ok: true,
    deleted: purgeUnusedGuests(),
  }));

  app.get("/api/admin/tournaments", { preHandler: requireAdmin }, async () => ({
    ok: true,
    tournaments: getDb().prepare(`
      SELECT t.id, t.name, t.status, t.format, t.mode, t.created_at AS createdAt,
             u.username AS creator, t.created_by AS creatorId,
             (SELECT COUNT(*) FROM tournament_participants p WHERE p.tournament_id = t.id) AS participants,
             (SELECT COUNT(*) FROM tournament_pairings p WHERE p.tournament_id = t.id AND p.game_id IS NOT NULL) AS games
      FROM tournaments t JOIN users u ON u.id = t.created_by
      ORDER BY t.created_at DESC LIMIT 200
    `).all(),
  }));

  app.post("/api/admin/tournaments/:id/start", { preHandler: requireAdmin }, async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    try {
      const gameCount = startTournament(params.id, null);
      notifyDeadlineChanged();
      notifyTournamentStarting(params.id);
      return { ok: true, gameCount };
    } catch (error) {
      if (error instanceof TournamentError) return reply.code(error.status).send({ error: error.message });
      throw error;
    }
  });

  app.post("/api/admin/tournaments/:id/cancel", { preHandler: requireAdmin }, async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    try {
      cancelTournament(params.id, null);
      return { ok: true };
    } catch (error) {
      if (error instanceof TournamentError) return reply.code(error.status).send({ error: error.message });
      throw error;
    }
  });

  app.get("/api/admin/invitations", { preHandler: requireAdmin }, async () => ({
    ok: true,
    invitations: getDb().prepare(`
      SELECT c.id, c.mode, c.created_at AS createdAt, c.expires_at AS expiresAt,
             c.is_link AS isLink, fu.username AS fromUser, tu.username AS toUser
      FROM challenges c JOIN users fu ON fu.id = c.from_user
      LEFT JOIN users tu ON tu.id = c.to_user
      ORDER BY c.created_at DESC LIMIT 500
    `).all(),
  }));

  app.delete("/api/admin/invitations/:id", { preHandler: requireAdmin }, async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    const result = getDb().prepare(`DELETE FROM challenges WHERE id = ?`).run(params.id);
    if (!result.changes) return reply.code(404).send({ error: "Invitation not found" });
    return { ok: true };
  });

  app.get("/api/admin/games", { preHandler: requireAdmin }, async () => ({
    ok: true,
    games: getDb().prepare(`
      SELECT g.id, g.status, g.result, g.termination, g.mode, g.ply,
             g.created_at AS createdAt, g.ended_at AS endedAt,
             wu.username AS white, bu.username AS black
      FROM games g JOIN users wu ON wu.id = g.white_id JOIN users bu ON bu.id = g.black_id
      ORDER BY CASE g.status WHEN 'started' THEN 0 ELSE 1 END, g.created_at DESC LIMIT 500
    `).all(),
  }));

  app.post("/api/admin/games/:id/terminate", { preHandler: requireAdmin }, async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    const result = terminateGameAsAdmin(params.id);
    if (!result.ok) return reply.code(result.error === "not_found" ? 404 : 409).send({ error: "Game is not active" });
    return { ok: true };
  });

  app.get("/api/admin/audit", { preHandler: requireAdmin }, async () => ({
    ok: true,
    entries: getDb().prepare(`
      SELECT a.id, a.action, a.target, a.details, a.created_at AS createdAt, u.username AS actor
      FROM admin_audit a JOIN users u ON u.id = a.actor_id
      ORDER BY a.created_at DESC, a.id DESC LIMIT 200
    `).all(),
  }));
}