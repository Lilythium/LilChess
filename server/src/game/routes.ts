import type { FastifyInstance, FastifyReply } from "fastify";
import { requireAuth } from "../auth/routes.js";
import {
  createChallenge,
  acceptChallengeTx,
  getMyGames,
  getUserProfileWithH2H,
  listChallenges,
  cancelChallenge,
  getGamePlayers,
  countOpenChallengesFrom,
  ChallengeError,
  MAX_OPEN_CHALLENGES,
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
  headToHead,
} from "../db/repositories/games.js";
import { getUserByUsername } from "../auth/queries.js";
import { notifyDeadlineChanged } from "./deadlineBus.js";
import { ChallengeBody, IdParams, MoveBody, UsernameParams, parse } from "../validation.js";

const STATUS: Record<string, number> = {
  not_found: 404,
  not_a_participant: 403,
  not_your_turn: 409,
  ply_mismatch: 409,
};
const fail = (reply: FastifyReply, error: string) => reply.code(STATUS[error] ?? 400).send({ error });

export async function gameRoutes(app: FastifyInstance) {
  app.post("/api/challenges", { preHandler: requireAuth }, async (req, reply) => {
    const body = parse(ChallengeBody, req.body, reply);
    if (!body) return reply;

    if (countOpenChallengesFrom(req.user!.id) >= MAX_OPEN_CHALLENGES) {
      return reply.code(429).send({ error: "Too many open challenges, cancel one first" });
    }

    let toUser: number | undefined;
    if (body.toUsername) {
      const target = getUserByUsername(body.toUsername);
      if (!target) return reply.code(404).send({ error: "User not found" });
      if (target.id === req.user!.id) return reply.code(400).send({ error: "Cannot challenge yourself" });
      toUser = target.id;
    }

    const challengeId = createChallenge({
      fromUser: req.user!.id,
      toUser,
      mode: body.mode,
      initialMs: body.mode === "live" ? body.initialMs : undefined,
      incrementMs: body.mode === "live" ? body.incrementMs : undefined,
      daysPerMove: body.mode === "correspondence" ? body.daysPerMove : undefined,
      colorPref: body.colorPref === "white" || body.colorPref === "black" ? body.colorPref : undefined,
    });
    return { ok: true, challengeId };
  });

  app.get("/api/challenges", { preHandler: requireAuth }, async (req) => listChallenges(req.user!.id));

  app.delete("/api/challenges/:id", { preHandler: requireAuth }, async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    if (!cancelChallenge(params.id, req.user!.id)) return reply.code(404).send({ error: "Not found" });
    return { ok: true };
  });

  app.post("/api/challenges/:id/accept", { preHandler: requireAuth }, async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;

    try {
      const gameId = acceptChallengeTx(params.id, req.user!.id);
      notifyDeadlineChanged();
      return { ok: true, gameId };
    } catch (err) {
      if (err instanceof ChallengeError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });

  app.get("/api/games/:id", { preHandler: requireAuth }, async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    const { id } = params;

    const game = getGame(id);
    if (!game) return reply.code(404).send({ error: "Game not found" });

    const players = getGamePlayers(id);
    let h2h: { wins: number; draws: number; losses: number } | null = null;
    if (players) {
      const me = req.user!.id;
      const them = players.whiteId === me ? players.blackId : players.blackId === me ? players.whiteId : null;
      if (them !== null) {
        const r = headToHead(me, them) as any;
        h2h = { wins: r?.wins ?? 0, draws: r?.draws ?? 0, losses: r?.losses ?? 0 };
      }
    }

    return { ok: true, game, sans: getMoveSans(id), players, h2h, serverNow: Date.now() };
  });

  app.get("/api/games/my-games", { preHandler: requireAuth }, async (req) => getMyGames(req.user!.id));

  app.get("/api/users/:username", { preHandler: requireAuth }, async (req, reply) => {
    const params = parse(UsernameParams, req.params, reply);
    if (!params) return reply;

    const data = getUserProfileWithH2H(params.username, req.user!.id);
    if (!data) return reply.code(404).send({ error: "User not found" });
    return { ok: true, ...data };
  });

  app.post("/api/games/:id/move", { preHandler: requireAuth }, async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    const body = parse(MoveBody, req.body, reply);
    if (!body) return reply;

    const result = submitMove(params.id, req.user!.id, body.ply, body.uci);
    if (!result.ok) return fail(reply, result.error);
    return { ok: true, state: result.state };
  });

  // resign / draw / abort share one shape, so register them in a loop
  const actions = [
    { path: "resign", run: resignAndPersist, returnState: true },
    { path: "draw/offer", run: offerDrawAndPersist, returnState: false },
    { path: "draw/accept", run: acceptDrawAndPersist, returnState: true },
    { path: "draw/decline", run: declineDrawAndPersist, returnState: false },
    { path: "abort", run: abortAndPersist, returnState: true },
  ] as const;

  for (const a of actions) {
    app.post(`/api/games/:id/${a.path}`, { preHandler: requireAuth }, async (req, reply) => {
      const params = parse(IdParams, req.params, reply);
      if (!params) return reply;
      const result = a.run(params.id, req.user!.id);
      if (!result.ok) return fail(reply, result.error);
      return a.returnState ? { ok: true, state: result.state } : { ok: true };
    });
  }
}