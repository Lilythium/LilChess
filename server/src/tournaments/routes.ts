import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/routes.js";
import { IdParams, parse } from "../validation.js";
import { notifyDeadlineChanged } from "../game/deadlineBus.js";
import { notifyTournamentStarting } from "../notifications/dispatch.js";
import {
  cancelTournament, createTournament, getTournament, joinTournament, listTournaments,
  startTournament, TournamentError, withdrawTournament,
} from "./service.js";

const CreateBody = z.object({
  name: z.string().trim().min(3).max(60),
  description: z.string().trim().max(500).optional(),
  mode: z.enum(["live", "correspondence"]),
  initialMs: z.number().int().min(30_000).max(86_400_000).optional(),
  incrementMs: z.number().int().min(0).max(60_000).optional(),
  daysPerMove: z.number().int().min(1).max(14).optional(),
  variant: z.enum(["standard", "chess960"]).default("standard"),
  rated: z.boolean().default(false),
  maxPlayers: z.number().int().min(2).max(16),
  startsAt: z.number().int().positive().optional(),
  endsAt: z.number().int().positive().optional(),
}).refine((body) => body.mode === "live"
  ? body.initialMs !== undefined && body.daysPerMove === undefined
  : body.daysPerMove !== undefined && body.initialMs === undefined && body.incrementMs === undefined,
{ message: "Provide time settings for the selected mode" })
  .refine((body) => body.startsAt === undefined || body.endsAt === undefined || body.endsAt > body.startsAt,
    { message: "End time must be after start time" });

async function handleTournamentError(reply: import("fastify").FastifyReply, error: unknown) {
  if (error instanceof TournamentError) return reply.code(error.status).send({ error: error.message });
  throw error;
}

export async function tournamentRoutes(app: FastifyInstance) {
  app.get("/api/tournaments", { preHandler: requireAuth }, async (req) => ({
    ok: true,
    tournaments: listTournaments(req.user!.id),
  }));

  app.post("/api/tournaments", { preHandler: requireAuth }, async (req, reply) => {
    if (req.user!.is_guest) return reply.code(403).send({ error: "Register an account to create tournaments" });
    const body = parse(CreateBody, req.body, reply);
    if (!body) return reply;
    return { ok: true, tournamentId: createTournament(req.user!.id, body) };
  });

  app.get("/api/tournaments/:id", { preHandler: requireAuth }, async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    const result = getTournament(params.id, req.user!.id);
    if (!result) return reply.code(404).send({ error: "Tournament not found" });
    return { ok: true, ...result };
  });

  app.post("/api/tournaments/:id/join", { preHandler: requireAuth }, async (req, reply) => {
    if (req.user!.is_guest) return reply.code(403).send({ error: "Register an account to join tournaments" });
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    try {
      joinTournament(params.id, req.user!.id);
      return { ok: true };
    } catch (error) { return handleTournamentError(reply, error); }
  });

  app.delete("/api/tournaments/:id/join", { preHandler: requireAuth }, async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    try {
      withdrawTournament(params.id, req.user!.id);
      return { ok: true };
    } catch (error) { return handleTournamentError(reply, error); }
  });

  app.post("/api/tournaments/:id/start", { preHandler: requireAuth }, async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    try {
      const gameCount = startTournament(params.id, req.user!.id);
      notifyDeadlineChanged();
      notifyTournamentStarting(params.id);
      return { ok: true, gameCount };
    } catch (error) { return handleTournamentError(reply, error); }
  });

  app.post("/api/tournaments/:id/cancel", { preHandler: requireAuth }, async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    try {
      cancelTournament(params.id, req.user!.id);
      return { ok: true };
    } catch (error) { return handleTournamentError(reply, error); }
  });
}