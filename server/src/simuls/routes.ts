import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { HOST_COLORS, MAX_SIMUL_PLAYERS, VARIANTS, normalizeUsername } from "@lilchess/shared";
import { requireAuth } from "../auth/routes.js";
import { notifyDeadlineChanged } from "../game/deadlineBus.js";
import { notifySimulInvited } from "../notifications/dispatch.js";
import { IdParams, parse } from "../validation.js";
import {
  cancelSimul, createSimul, getSimulDetail, inviteToSimul, listSimuls, respondToInvite, SimulError, startSimul,
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
      const { hostExtraMinutes, ...rest } = body;
      return { ok: true, simulId: createSimul(req.user!.id, { ...rest, hostExtraMs: hostExtraMinutes * 60_000 }) };
    } catch (error) { return simulError(reply, error); }
  });

  app.get("/api/simuls/:id", { preHandler: requireAuth }, async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    const detail = getSimulDetail(params.id, req.user!.id);
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
      const detail = getSimulDetail(params.id, req.user!.id);
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
}