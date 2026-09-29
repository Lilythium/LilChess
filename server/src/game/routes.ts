import { FastifyInstance } from "fastify";
import { requireAuth } from "../auth/routes.js";
import {
  createChallenge,
  acceptChallengeTx,
  getMyGames,
  getUserProfileWithH2H,
  listChallenges,
  cancelChallenge,  
  getGamePlayers,
} from "./queries.js";
import {
  submitMove,
  resignAndPersist,
  offerDrawAndPersist,
  acceptDrawAndPersist,
  declineDrawAndPersist,
  abortAndPersist,
  getGame,
  getMoveSans, 
} from "../db/repositories/games.js";
import { getUserByUsername } from "../auth/queries.js";
import { notifyDeadlineChanged } from "./deadlineBus.js";

export async function gameRoutes(app: FastifyInstance) {
  // Create a challenge
  app.post("/api/challenges", { preHandler: requireAuth }, async (req, reply) => {
    const { mode, toUsername, initialMs, incrementMs, daysPerMove, colorPref } = req.body as any;

    if (mode === "live") {
      if (!Number.isFinite(initialMs) || initialMs <= 0) {
        return reply.code(400).send({ error: "initialMs required" });
      }
    } else if (mode === "correspondence") {
      if (!Number.isInteger(daysPerMove) || daysPerMove < 1) {
        return reply.code(400).send({ error: "daysPerMove required" });
      }
    } else {
      return reply.code(400).send({ error: "Invalid mode" });
    }

    let toUser: number | undefined;
    if (toUsername) {
      const target = getUserByUsername(toUsername);
      if (!target) return reply.code(404).send({ error: "User not found" });
      if (target.id === req.user!.id) return reply.code(400).send({ error: "Cannot challenge yourself" });
      toUser = target.id;
    }

    const challengeId = createChallenge({
      fromUser: req.user!.id,
      toUser,
      mode,
      initialMs,
      incrementMs,
      daysPerMove,
      colorPref: colorPref === "white" || colorPref === "black" ? colorPref : undefined,
    });
    return { ok: true, challengeId };
  });

  app.get("/api/challenges", { preHandler: requireAuth }, async (req) => listChallenges(req.user!.id));

  app.delete("/api/challenges/:id", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!cancelChallenge(id, req.user!.id)) return reply.code(404).send({ error: "Not found" });
    return { ok: true };
  });

  // Accept a challenge
  app.post("/api/challenges/:id/accept", { preHandler: requireAuth }, async (req) => {
    const { id } = req.params as { id: string };

    const gameId = acceptChallengeTx(id, req.user!.id);
    notifyDeadlineChanged();
    return { ok: true, gameId };
  });

  // Fetch a game
  app.get("/api/games/:id", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };

    const game = getGame(id);
    if (!game) return reply.code(404).send({ error: "Game not found" });

    return {
      ok: true,
      game,
      sans: getMoveSans(id),
      players: getGamePlayers(id),
      serverNow: Date.now(),
    };
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
    const { id } = req.params as { id: string };
    const result = resignAndPersist(id, req.user!.id);
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return { ok: true, state: result.state };
  });

  app.post("/api/games/:id/draw/offer", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = offerDrawAndPersist(id, req.user!.id);
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return { ok: true };
  });

  app.post("/api/games/:id/draw/accept", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = acceptDrawAndPersist(id, req.user!.id);
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return { ok: true, state: result.state };
  });

  app.post("/api/games/:id/draw/decline", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = declineDrawAndPersist(id, req.user!.id);
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return { ok: true };
  });

  app.post("/api/games/:id/abort", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = abortAndPersist(id, req.user!.id);
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return { ok: true, state: result.state };
  });
}