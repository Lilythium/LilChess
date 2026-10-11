import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { parsePgnGames } from "@lilchess/shared";
import { requireAuth } from "../auth/routes.js";
import { IdParams, ImportPgnBody, parse } from "../validation.js";
import {
  MAX_IMPORTED_PER_USER,
  countImportedGames,
  deleteImportedGame,
  getImportedGame,
  listImportedGames,
  saveImportedGames,
} from "./queries.js";

const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(60),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function importedRoutes(app: FastifyInstance) {
  app.post(
    "/api/imported",
    { preHandler: requireAuth, config: { rateLimit: { max: 20, timeWindow: "1 hour" } } },
    async (req, reply) => {
      if (req.user!.is_guest) {
        return reply.code(403).send({ error: "Guests cannot import games. Register an account first." });
      }
      const body = parse(ImportPgnBody, req.body, reply);
      if (!body) return reply;

      const { games, failures } = parsePgnGames(body.pgn);
      if (games.length === 0) {
        return reply.code(400).send({ error: failures[0]?.message ?? "No games found in that file.", failures });
      }

      const saved = saveImportedGames(req.user!.id, games);
      if (saved.imported.length === 0 && saved.duplicates === 0 && saved.overLimit > 0) {
        return reply.code(409).send({
          error: `You can keep up to ${MAX_IMPORTED_PER_USER} imported games. Delete some to import more.`,
          failures,
        });
      }
      return { ok: true, imported: saved.imported, duplicates: saved.duplicates, overLimit: saved.overLimit, failures };
    },
  );

  app.get("/api/imported", { preHandler: requireAuth }, async (req, reply) => {
    const query = parse(ListQuery, req.query, reply);
    if (!query) return reply;
    return {
      ok: true,
      total: countImportedGames(req.user!.id),
      games: listImportedGames(req.user!.id, query.limit, query.offset),
    };
  });

  // Same shape as GET /api/games/:id/analysis, so the analysis page opens either kind of game.
  app.get("/api/imported/:id", { preHandler: requireAuth }, async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    const game = getImportedGame(req.user!.id, params.id);
    if (!game) return reply.code(404).send({ error: "Game not found" });
    return {
      ok: true,
      variant: game.variant,
      initialFen: game.initialFen,
      moves: game.moves,
      status: "finished",
      result: game.result === "*" ? null : game.result,
      termination: game.termination,
      white: game.white,
      black: game.black,
      event: game.event,
      site: game.site,
      date: game.date,
    };
  });

  app.delete("/api/imported/:id", { preHandler: requireAuth }, async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    if (!deleteImportedGame(req.user!.id, params.id)) return reply.code(404).send({ error: "Game not found" });
    return { ok: true };
  });
}