import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { TOURNAMENT_FORMATS } from "@lilchess/shared";
import { requireAuth } from "../auth/routes.js";
import { IdParams, parse } from "../validation.js";
import { notifyDeadlineChanged } from "../game/deadlineBus.js";
import { notifyTournamentStarting } from "../notifications/dispatch.js";
import {
  cancelTournament, createTournament, getTournament, joinTournament, listTournaments, MAX_PLAYERS,
  pauseTournament, startTournament, TournamentError, withdrawTournament, resumeTournament,
} from "./service.js";

const CreateBody = z.object({
  name: z.string().trim().min(3).max(60),
  description: z.string().trim().max(500).optional(),
  format: z.enum(TOURNAMENT_FORMATS).default("round_robin"),
  mode: z.enum(["live", "correspondence"]),
  initialMs: z.number().int().min(30_000).max(86_400_000).optional(),
  incrementMs: z.number().int().min(0).max(60_000).optional(),
  daysPerMove: z.number().int().min(1).max(14).optional(),
  variant: z.enum(["standard", "chess960"]).default("standard"),
  rated: z.boolean().default(false),
  maxPlayers: z.number().int().min(2).max(64),
  rounds: z.number().int().min(1).max(20).optional(), // swiss only
  durationMinutes: z.number().int().min(5).max(720).optional(), // arena only
  streakBonus: z.boolean().default(true), // arena only
  startsAt: z.number().int().positive().optional(),
  endsAt: z.number().int().positive().optional(),
}).refine((body) => body.mode === "live"
  ? body.initialMs !== undefined && body.daysPerMove === undefined
  : body.daysPerMove !== undefined && body.initialMs === undefined && body.incrementMs === undefined,
{ message: "Provide time settings for the selected mode" })
  .refine((body) => body.format !== "arena" || (body.mode === "live" && body.durationMinutes !== undefined),
    { message: "Arenas are live-only and need a duration" })
  .refine((body) => body.format === "arena" || body.durationMinutes === undefined,
    { message: "Duration only applies to arenas" })
  .refine((body) => body.format === "swiss" || body.rounds === undefined,
    { message: "Rounds only apply to swiss tournaments" })
  .refine((body) => body.maxPlayers <= MAX_PLAYERS[body.format],
    { message: "Too many players for this format" })
  .refine((body) => body.rounds === undefined || body.rounds <= body.maxPlayers - 1,
    { message: "A swiss cannot have more rounds than players minus one" })
  .refine((body) => body.startsAt === undefined || body.startsAt > Date.now(),
    { message: "Start time must be in the future" })
  .refine((body) => body.endsAt === undefined || body.startsAt === undefined || body.endsAt > body.startsAt,
    { message: "End time must be after the start time" });

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
    try {
      const { durationMinutes, ...config } = body;
      return {
        ok: true,
        tournamentId: createTournament(req.user!.id, {
          ...config, durationMs: durationMinutes === undefined ? undefined : durationMinutes * 60_000,
        }),
      };
    } catch (error) { return handleTournamentError(reply, error); }
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
      notifyDeadlineChanged(); // a late arena joiner can be paired straight away
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

  // A player who aborted a game is paused; this puts them back into the pairings from the next round.
  app.post("/api/tournaments/:id/resume", { preHandler: requireAuth }, async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    try {
      resumeTournament(params.id, req.user!.id);
      notifyDeadlineChanged();
      return { ok: true };
    } catch (error) { return handleTournamentError(reply, error); }
  });

  // Sit out an arena or swiss without leaving it; resume above brings you back.
  app.post("/api/tournaments/:id/pause", { preHandler: requireAuth }, async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    try {
      pauseTournament(params.id, req.user!.id);
      return { ok: true };
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