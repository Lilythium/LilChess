import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { getDb } from "../db/connection.js";
import { terminateGameAsAdmin } from "../db/repositories/games.js";
import { requireAdmin } from "../auth/routes.js";
import { hashPassword } from "../auth/crypto.js";
import {
  countActiveInvites,
  createRegistrationInvite,
  listRegistrationInvites,
  normalizeInviteCode,
  revokeRegistrationInvite,
} from "../auth/invites.js";
import { cancelTournament, startTournament, TournamentError } from "../tournaments/service.js";
import { notifyDeadlineChanged } from "../game/deadlineBus.js";
import { notifyTournamentStarting } from "../notifications/dispatch.js";
import { IdParams, RegisterBody, parse } from "../validation.js";
import { purgeUnusedGuests } from "../maintenance.js";
import { closeUserSockets } from "../ws/hub.js";
import { recordAudit } from "./audit.js";
import { AdminError, createUserAsAdmin, issuePasswordResetLink, revokeUserSessions, setUserAdmin, setUserDisabled } from "./users.js";

const DAY_MS = 86_400_000;

const UserParams = z.object({ id: z.coerce.number().int().positive() });
const AdminBody = z.object({ isAdmin: z.boolean() });
const CreateUserBody = RegisterBody.pick({ username: true, password: true }).extend({ isAdmin: z.boolean().default(false) });
const InviteParams = z.object({ code: z.string().regex(/^[A-Za-z0-9-]{8,40}$/, "Invalid invite code") });
const CreateInviteBody = z.object({
  note: z.string().trim().max(80).optional(),
  maxUses: z.number().int().min(1).max(1000).default(1),
  expiresInDays: z.number().int().min(1).max(365).nullable().default(null),
});

export async function adminRoutes(app: FastifyInstance) {
  // Every change below records itself through recordAudit (inside the change's own transaction where
  // it can). Reading pages is deliberately not logged.

  // Runs a service call and turns its expected errors into replies (undefined means "reply already sent").
  // Anything else is a real bug and surfaces as a 500.
  const guarded = <T>(reply: FastifyReply, fn: () => T): T | undefined => {
    try {
      return fn();
    } catch (error) {
      if (error instanceof AdminError || error instanceof TournamentError) {
        void reply.code(error.status).send({ error: error.message });
        return undefined;
      }
      throw error;
    }
  };

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
        disabledUsers: counts("users", "WHERE disabled_at IS NOT NULL"),
        activeGames: counts("games", "WHERE status = 'started'"),
        completedGames: counts("games", "WHERE status <> 'started'"),
        openChallenges: counts("challenges", "WHERE expires_at > ?", [Date.now()]),
        activeInviteCodes: countActiveInvites(),
        openTournaments: counts("tournaments", "WHERE status = 'open'"),
        runningTournaments: counts("tournaments", "WHERE status = 'running'"),
      },
    };
  });

  // ---- users ----

  app.get("/api/admin/users", { preHandler: requireAdmin }, async () => ({
    ok: true,
    users: getDb().prepare(`
      SELECT u.id, u.username, u.created_at AS createdAt, u.is_admin AS isAdmin,
             u.is_guest AS isGuest, u.email, u.disabled_at AS disabledAt,
             (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > ?) AS activeSessions,
             (SELECT COUNT(*) FROM games g WHERE g.white_id = u.id OR g.black_id = u.id) AS gameCount,
             (SELECT COUNT(*) FROM games g WHERE g.status = 'started' AND (g.white_id = u.id OR g.black_id = u.id)) AS activeGames
      FROM users u WHERE u.deleted_at IS NULL ORDER BY u.created_at DESC LIMIT 500
    `).all(Date.now()),
  }));

  // Works in every registration mode, which is what makes REGISTRATION=closed usable.
  app.post("/api/admin/users", { preHandler: requireAdmin }, async (req, reply) => {
    const body = parse(CreateUserBody, req.body, reply);
    if (!body) return reply;
    const passwordHash = await hashPassword(body.password);
    const user = guarded(reply, () => createUserAsAdmin(req.user!.id, body.username, passwordHash, body.isAdmin));
    if (!user) return reply;
    return { ok: true, user };
  });

  app.patch("/api/admin/users/:id", { preHandler: requireAdmin }, async (req, reply) => {
    const params = parse(UserParams, req.params, reply);
    const body = parse(AdminBody, req.body, reply);
    if (!params || !body) return reply;
    const changed = guarded(reply, () => setUserAdmin(req.user!.id, params.id, body.isAdmin));
    if (changed === undefined) return reply;
    return { ok: true, changed };
  });

  app.post("/api/admin/users/:id/disable", { preHandler: requireAdmin }, async (req, reply) => {
    const params = parse(UserParams, req.params, reply);
    if (!params) return reply;
    const result = guarded(reply, () => setUserDisabled(req.user!.id, params.id, true));
    if (!result) return reply;
    closeUserSockets(params.id);
    return { ok: true, activeGames: result.activeGames };
  });

  app.post("/api/admin/users/:id/enable", { preHandler: requireAdmin }, async (req, reply) => {
    const params = parse(UserParams, req.params, reply);
    if (!params) return reply;
    if (!guarded(reply, () => setUserDisabled(req.user!.id, params.id, false))) return reply;
    return { ok: true };
  });

  // Returns the link once; only a hash of the token is stored, so it can't be shown again.
  app.post("/api/admin/users/:id/reset-link", { preHandler: requireAdmin }, async (req, reply) => {
    const params = parse(UserParams, req.params, reply);
    if (!params) return reply;
    const issued = guarded(reply, () => issuePasswordResetLink(req.user!.id, params.id));
    if (!issued) return reply;
    const origin = config.baseOrigin ?? `${req.protocol}://${req.hostname}`;
    return { ok: true, username: issued.username, link: `${origin}/#/reset/${issued.token}`, expiresAt: issued.expiresAt };
  });

  app.post("/api/admin/users/:id/revoke-sessions", { preHandler: requireAdmin }, async (req, reply) => {
    const params = parse(UserParams, req.params, reply);
    if (!params) return reply;
    const revoked = guarded(reply, () => revokeUserSessions(req.user!.id, params.id));
    if (revoked === undefined) return reply;
    return { ok: true, revoked };
  });

  app.post("/api/admin/users/purge-guests", { preHandler: requireAdmin }, async (req) => {
    const deleted = getDb().transaction(() => {
      const count = purgeUnusedGuests();
      recordAudit(req.user!.id, "guests.purge", "guests", { deleted: count });
      return count;
    }).immediate();
    return { ok: true, deleted };
  });

  // ---- registration invite codes (REGISTRATION=invite) ----

  app.get("/api/admin/invites", { preHandler: requireAdmin }, async () => ({
    ok: true,
    invites: listRegistrationInvites(),
  }));

  app.post("/api/admin/invites", { preHandler: requireAdmin }, async (req, reply) => {
    const body = parse(CreateInviteBody, req.body, reply);
    if (!body) return reply;
    const invite = getDb().transaction(() => {
      const created = createRegistrationInvite(req.user!.id, {
        note: body.note || null,
        maxUses: body.maxUses,
        expiresAt: body.expiresInDays === null ? null : Date.now() + body.expiresInDays * DAY_MS,
      });
      recordAudit(req.user!.id, "invite.create", `invite:${created.code}`, {
        note: created.note, maxUses: created.maxUses, expiresAt: created.expiresAt,
      });
      return created;
    }).immediate();
    return { ok: true, invite };
  });

  app.post("/api/admin/invites/:code/revoke", { preHandler: requireAdmin }, async (req, reply) => {
    const params = parse(InviteParams, req.params, reply);
    if (!params) return reply;
    const code = normalizeInviteCode(params.code);
    const outcome = getDb().transaction(() => {
      const result = revokeRegistrationInvite(code);
      if (result === "revoked") recordAudit(req.user!.id, "invite.revoke", `invite:${code}`);
      return result;
    }).immediate();
    if (outcome === "not_found") return reply.code(404).send({ error: "Invite code not found" });
    if (outcome === "already_revoked") return reply.code(409).send({ error: "Invite code is already revoked" });
    return { ok: true };
  });

  // ---- tournaments ----

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
    const gameCount = guarded(reply, () => startTournament(params.id, null));
    if (gameCount === undefined) return reply;
    recordAudit(req.user!.id, "tournament.start", `tournament:${params.id}`, { gameCount });
    notifyDeadlineChanged();
    notifyTournamentStarting(params.id);
    return { ok: true, gameCount };
  });

  app.post("/api/admin/tournaments/:id/cancel", { preHandler: requireAdmin }, async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    const cancelled = guarded(reply, () => {
      cancelTournament(params.id, null);
      return true;
    });
    if (!cancelled) return reply;
    recordAudit(req.user!.id, "tournament.cancel", `tournament:${params.id}`);
    return { ok: true };
  });

  // ---- open challenges (the old "invitations" list: seeks, direct challenges and challenge links) ----

  app.get("/api/admin/challenges", { preHandler: requireAdmin }, async () => ({
    ok: true,
    challenges: getDb().prepare(`
      SELECT c.id, c.mode, c.created_at AS createdAt, c.expires_at AS expiresAt,
             c.is_link AS isLink, fu.username AS fromUser, tu.username AS toUser
      FROM challenges c JOIN users fu ON fu.id = c.from_user
      LEFT JOIN users tu ON tu.id = c.to_user
      ORDER BY c.created_at DESC LIMIT 500
    `).all(),
  }));

  app.delete("/api/admin/challenges/:id", { preHandler: requireAdmin }, async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    const removed = getDb().transaction(() => {
      const row = getDb().prepare(`
        SELECT fu.username AS fromUser FROM challenges c JOIN users fu ON fu.id = c.from_user WHERE c.id = ?
      `).get(params.id) as { fromUser: string } | undefined;
      if (!row) return false;
      getDb().prepare(`DELETE FROM challenges WHERE id = ?`).run(params.id);
      recordAudit(req.user!.id, "challenge.delete", `challenge:${params.id}`, { fromUser: row.fromUser });
      return true;
    }).immediate();
    if (!removed) return reply.code(404).send({ error: "Challenge not found" });
    return { ok: true };
  });

  // ---- games ----

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
    recordAudit(req.user!.id, "game.terminate", `game:${params.id}`);
    return { ok: true };
  });

  // ---- audit log ----

  app.get("/api/admin/audit", { preHandler: requireAdmin }, async () => ({
    ok: true,
    // Older versions logged every page view as "GET /api/admin/...". Those rows stay in the table but are
    // hidden here, so real actions are what you see.
    entries: getDb().prepare(`
      SELECT a.id, a.action, a.target, a.details, a.created_at AS createdAt, u.username AS actor
      FROM admin_audit a JOIN users u ON u.id = a.actor_id
      WHERE a.action NOT LIKE 'GET %'
      ORDER BY a.created_at DESC, a.id DESC LIMIT 200
    `).all(),
  }));
}