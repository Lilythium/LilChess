import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { VARIANTS, startFenFor } from "@lilchess/shared";
import { requireAuth } from "../auth/routes.js";
import { parse } from "../validation.js";
import { openingExplorer } from "./stats.js";

const Query = z.object({
  variant: z.enum(VARIANTS).default("standard"),
  fen: z.string().min(1).max(200).optional(),
});

export async function openingsRoutes(app: FastifyInstance) {
  // GET /api/openings?variant=standard&fen=...   (no fen = the variant's start position)
  app.get("/api/openings", { preHandler: requireAuth }, async (req, reply) => {
    const query = parse(Query, req.query, reply);
    if (!query) return reply;
    try {
      return { ok: true, ...openingExplorer(query.variant, query.fen ?? startFenFor(query.variant)) };
    } catch {
      return reply.code(400).send({ error: "Invalid position" });
    }
  });
}
