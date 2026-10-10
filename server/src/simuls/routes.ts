import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { HOST_COLORS, MAX_SIMUL_PLAYERS, VARIANTS, normalizeUsername } from "@lilchess/shared";
import { requireAuth } from "../auth/routes.js";
import { notifyDeadlineChanged } from "../game/deadlineBus.js";
import { notifySimulInvited } from "../notifications/dispatch.js";
import { Id, IdParams, parse } from "../validation.js";
import {
  cancelSimul, createSimul, getSimulDetail, inviteToSimul, listSimuls, respondToInvite, SimulError, startSimul, getSimulInvitePreview, joinByCode, joinSimul, resetInviteCode
} from "./service.js";

const CreateBody = z.object({
  name: z.string().trim().min(3).max(60),
  mode: z.enum(["live", "correspondence"]),
  initialMs: z.number().int().min(60_000).max(3_600_000).optional(),
  incrementMs: z.number().int().min(0).max(60_000).optional(),
  daysPerMove: z.number().int().min(1).max(14).optional(),
  hostExtraMinutes: z.number().int().min(0).max(240).default(0),
  variant: z.enum(VARIANTS).default("standard"),
  hostColor: z.enum(HOST_COLORS).default("white"),
  maxPlayers: z.number().int().min(2).max(MAX_SIMUL_PLAYERS),
  public: z.boolean().default(true),
})
  .refine((b) => b.mode === "live"
    ? b.initialMs !== undefined && b.daysPerMove === undefined
    : b.daysPerMove !== undefined && b.initialMs === undefined && b.incrementMs === undefined,
  { message: "Provide time settings for the selected mode" })
  .refine((b) => b.mode === "live" || b.hostExtraMinutes === 0, { message: "Extra host time only applies to live simuls" })
  // Live games abort when the side to move waits more than 30 s after the opponent's first move.
  .refine((b) => b.mode === "correspondence" || b.hostColor === "white",
    { message: "In live simuls the host plays white on every board" });

const InviteBody = z.object({
  usernames: z.array(z.string().trim().min(1).max(64).transform(normalizeUsername)).min(1).max(20),
});
const RespondBody = z.object({ accept: z.boolean() });
const CodeParams = z.object({ code: Id });

async function simulError(reply: FastifyReply, error: unknown) {
  if (error instanceof SimulError) return reply.code(error.status).send({ error: error.message });
  throw error;
}

export async function simulRoutes(app: FastifyInstance) {
  app.get("/api/simuls", { preHandler: requireAuth }, async (req) => ({ ok: true, ...listSimuls(req.user!.id) }));

  app.post("/api/simuls", { preHandler: requireAuth }, async (req, reply) => {
    if (req.user!.is_guest) return reply.code(403).send({ error: "Register an account to host a simul" });
    const body = parse(CreateBody, req.body, reply);
    if (!body) return reply;
    try {
      const { hostExtraMinutes, public: isPublic, ...rest } = body;
      return { ok: true, simulId: createSimul(req.user!.id, { ...rest, isPublic, hostExtraMs: hostExtraMinutes * 60_000 }) };
    } catch (error) { return simulError(reply, error); }
  });

  app.get("/api/simuls/:id", { preHandler: requireAuth }, async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    const detail = getSimulDetail(params.id, req.user!.id, !!req.user!.is_guest);
    if (!detail) return reply.code(404).send({ error: "Simul not found" });
    return { ok: true, ...detail };
  });

  app.post("/api/simuls/:id/invite", { preHandler: requireAuth }, async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    const body = parse(InviteBody, req.body, reply);
    if (!body) return reply;
    try {
      const result = inviteToSimul(params.id, req.user!.id, body.usernames);
      const detail = getSimulDetail(params.id, req.user!.id, !!req.user!.is_guest);
      for (const user of result.invited) {
        notifySimulInvited({ simulId: params.id, simulName: detail?.simul.name ?? "", hostName: req.user!.username, toId: user.id });
      }
      return { ok: true, invited: result.invited.map((u) => u.username), skipped: result.skipped };
    } catch (error) { return simulError(reply, error); }
  });

  app.post("/api/simuls/:id/respond", { preHandler: requireAuth }, async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    const body = parse(RespondBody, req.body, reply);
    if (!body) return reply;
    try {
      respondToInvite(params.id, req.user!.id, body.accept);
      return { ok: true };
    } catch (error) { return simulError(reply, error); }
  });

  app.post("/api/simuls/:id/start", { preHandler: requireAuth }, async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    try {
      const boards = startSimul(params.id, req.user!.id);
      notifyDeadlineChanged(); // the scheduler needs to see the new deadlines
      return { ok: true, boards };
    } catch (error) { return simulError(reply, error); }
  });

  app.post("/api/simuls/:id/cancel", { preHandler: requireAuth }, async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    try {
      cancelSimul(params.id, req.user!.id);
      return { ok: true };
    } catch (error) { return simulError(reply, error); }
  });

  // Public (no session): lets a logged-out visitor see what a link is for.
  app.get("/api/simul-invites/:code", async (req, reply) => {
    const params = parse(CodeParams, req.params, reply);
    if (!params) return reply;
    const invite = getSimulInvitePreview(params.code);
    if (!invite) return reply.code(404).send({ error: "This invite link is invalid or has expired" });
    return { ok: true, invite };
  });

  app.post("/api/simuls/:id/join", { preHandler: requireAuth }, async (req, reply) => {
    if (req.user!.is_guest) return reply.code(403).send({ error: "Register an account to join a simul" });
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    try {
      joinSimul(params.id, req.user!.id, false);
      return { ok: true };
    } catch (error) { return simulError(reply, error); }
  });

  app.post("/api/simuls/join-code/:code", { preHandler: requireAuth }, async (req, reply) => {
    if (req.user!.is_guest) return reply.code(403).send({ error: "Register an account to join a simul" });
    const params = parse(CodeParams, req.params, reply);
    if (!params) return reply;
    try {
      return { ok: true, simulId: joinByCode(params.code, req.user!.id) };
    } catch (error) { return simulError(reply, error); }
  });

  app.post("/api/simuls/:id/invite-link/reset", { preHandler: requireAuth }, async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    try {
      return { ok: true, inviteCode: resetInviteCode(params.id, req.user!.id) };
    } catch (error) { return simulError(reply, error); }
  });
}