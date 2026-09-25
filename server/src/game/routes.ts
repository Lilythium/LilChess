import { FastifyInstance } from "fastify";
import { requireAuth } from "../auth/routes.js";
import { createChallenge, acceptChallengeTx } from "./queries.js";
import { getDb } from "../db/connection.js";

export async function gameRoutes(app: FastifyInstance) {
  
  // Create a challenge
  app.post("/api/challenges", { preHandler: requireAuth }, async (req, reply) => {
    const { mode, toUser, initialMs, incrementMs, daysPerMove, colorPref } = req.body as any;
    
    // Basic validation
    if (!["live", "correspondence"].includes(mode)) {
      return reply.code(400).send({ error: "Invalid mode" });
    }

    const challengeId = createChallenge({
      fromUser: req.user!.id,
      toUser,
      mode,
      initialMs,
      incrementMs,
      daysPerMove,
      colorPref
    });

    return { ok: true, challengeId };
  });

  // Accept a challenge
  app.post("/api/challenges/:id/accept", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    
    try {
      const gameId = acceptChallengeTx(id, req.user!.id);
      return { ok: true, gameId };
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  // Fetch a game
  app.get("/api/games/:id", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    
    const game = getDb().prepare(`SELECT * FROM games WHERE id = ?`).get(id);
    if (!game) return reply.code(404).send({ error: "Game not found" });

    const moves = getDb().prepare(`SELECT ply, uci, san FROM moves WHERE game_id = ? ORDER BY ply ASC`).all(id);
    
    return { ok: true, game, moves };
  });
}