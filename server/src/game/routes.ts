import { FastifyInstance } from "fastify";
import { requireAuth } from "../auth/routes.js";
import { createChallenge, acceptChallengeTx, getMyGames, getUserProfileWithH2H } from "./queries.js";
import { getDb } from "../db/connection.js";
import {
  submitMove,
  resignAndPersist,
  offerDrawAndPersist,
  acceptDrawAndPersist,
  declineDrawAndPersist,
  abortAndPersist,
} from "../db/repositories/games.js";

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
  
  // Get "My Games" dashboard
  app.get("/api/games/my-games", { preHandler: requireAuth }, async (req) => {
    return getMyGames(req.user!.id);
  });

  // Get User Profile & Head-to-Head
  app.get("/api/users/:username", { preHandler: requireAuth }, async (req, reply) => {
    const { username } = req.params as { username: string };
    
    const data = getUserProfileWithH2H(username, req.user!.id);
    if (!data) return reply.code(404).send({ error: "User not found" });

    return { ok: true, ...data };
  });
  
  app.post("/api/games/:id/move", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { ply, uci } = req.body as { ply: number; uci: string };

    const result = submitMove(id, req.user!.id, ply, uci);
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return { ok: true, state: result.state };
  });

  app.post("/api/games/:id/resign", { preHandler: requireAuth }, async (req, reply) => {
    const result = resignAndPersist((req.params as { id: string }).id, req.user!.id);
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return { ok: true, state: result.state };
  });

  app.post("/api/games/:id/draw/offer", { preHandler: requireAuth }, async (req, reply) => {
    const result = offerDrawAndPersist((req.params as { id: string }).id, req.user!.id);
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return { ok: true };
  });

  app.post("/api/games/:id/draw/accept", { preHandler: requireAuth }, async (req, reply) => {
    const result = acceptDrawAndPersist((req.params as { id: string }).id, req.user!.id);
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return { ok: true, state: result.state };
  });

  app.post("/api/games/:id/draw/decline", { preHandler: requireAuth }, async (req, reply) => {
    const result = declineDrawAndPersist((req.params as { id: string }).id, req.user!.id);
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return { ok: true };
  });

  app.post("/api/games/:id/abort", { preHandler: requireAuth }, async (req, reply) => {
    const result = abortAndPersist((req.params as { id: string }).id, req.user!.id);
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return { ok: true, state: result.state };
  });
}