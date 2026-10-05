import type { FastifyInstance, FastifyReply } from "fastify";
import { buildPgn } from "@lilchess/shared";
import { config } from "../config.js";
import { requireAuth } from "../auth/routes.js";
import {
createChallenge,
acceptChallengeTx,
getMyGames,
getUserProfileWithH2H,
listChallenges,
cancelChallenge,
getGamePlayers,
getLiveGames,
getInvitePreview,
ChallengeError,
} from "./queries.js";
import {
submitMove,
resignAndPersist,
offerDrawAndPersist,
acceptDrawAndPersist,
declineDrawAndPersist,
abortAndPersist,
offerTakebackAndPersist,
acceptTakebackAndPersist,
declineTakebackAndPersist,
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
game_not_active: 409,
deadline_passed: 409,
};

const fail = (reply: FastifyReply, error: string) =>
reply.code(STATUS[error] ?? 400).send({ error });

export async function gameRoutes(app: FastifyInstance) {
app.post("/api/challenges", { preHandler: requireAuth }, async (req, reply) => {
if (req.user!.is_guest) {
return reply.code(403).send({
error: "Guests can't create challenges. Register an account to create games.",
});
}

const body = parse(ChallengeBody, req.body, reply);
if (!body) return reply;

const isLink = body.link === true;
let toUser: number | undefined;

if (body.toUsername && !isLink) {
  const target = getUserByUsername(body.toUsername);

  if (!target) return reply.code(404).send({ error: "User not found" });
  if (target.id === req.user!.id) {
    return reply.code(400).send({ error: "Cannot challenge yourself" });
  }
  if (target.is_guest) {
    return reply.code(400).send({ error: "Cannot challenge a guest" });
  }

  toUser = target.id;
}

const challengeId = createChallenge({
  fromUser: req.user!.id,
  toUser,
  mode: body.mode,
  initialMs: body.mode === "live" ? body.initialMs : undefined,
  incrementMs: body.mode === "live" ? body.incrementMs : undefined,
  daysPerMove: body.mode === "correspondence" ? body.daysPerMove : undefined,
  colorPref:
    body.colorPref === "white" || body.colorPref === "black"
      ? body.colorPref
      : undefined,
  isLink,
  variant: body.variant,
});

return { ok: true, challengeId };

});

// Public (no session): lets a logged-out visitor see what they're being invited to.
app.get("/api/invites/:id", async (req, reply) => {
const params = parse(IdParams, req.params, reply);
if (!params) return reply;


const invite = getInvitePreview(params.id);
if (!invite) {
  return reply.code(404).send({ error: "This invite link is invalid or has expired" });
}

return {
  ok: true,
  invite,
  guestsAllowed: config.allowGuests && config.registration !== "closed" && !invite.targeted,
};


});

app.get("/api/challenges", { preHandler: requireAuth }, async (req) => ({
ok: true,
...listChallenges(req.user!.id),
}));

app.delete("/api/challenges/:id", { preHandler: requireAuth }, async (req, reply) => {
const params = parse(IdParams, req.params, reply);
if (!params) return reply;

if (!cancelChallenge(params.id, req.user!.id)) {
  return reply.code(404).send({ error: "Not found" });
}

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
  if (err instanceof ChallengeError) {
    return reply.code(err.status).send({ error: err.message });
  }
  throw err;
}


});

app.get("/api/games/live", { preHandler: requireAuth }, async () => ({
ok: true,
games: getLiveGames(),
}));

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
  const them =
    players.whiteId === me
      ? players.blackId
      : players.blackId === me
        ? players.whiteId
        : null;

  if (them !== null) {
    const r = headToHead(me, them) as any;
    h2h = {
      wins: r?.wins ?? 0,
      draws: r?.draws ?? 0,
      losses: r?.losses ?? 0,
    };
  }
}

return {
  ok: true,
  game,
  sans: getMoveSans(id),
  players,
  h2h,
  serverNow: Date.now(),
};


});

app.get("/api/games/:id/pgn", { preHandler: requireAuth }, async (req, reply) => {
const params = parse(IdParams, req.params, reply);
if (!params) return reply;


const game = getGame(params.id);
const players = getGamePlayers(params.id);

if (!game || !players) {
  return reply.code(404).send({ error: "Game not found" });
}

const pgn = buildPgn({
  game,
  sans: getMoveSans(params.id),
  white: players.whiteName,
  black: players.blackName,
  createdAt: players.createdAt,
  site: config.baseOrigin,
});

return reply
  .header("content-type", "application/x-chess-pgn; charset=utf-8")
  .header("content-disposition", `attachment; filename="lilchess-${params.id}.pgn"`)
  .send(pgn);


});

app.get("/api/games/my-games", { preHandler: requireAuth }, async (req) => ({
ok: true,
...getMyGames(req.user!.id),
}));

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
return { ok: true };

});

// Resign / draw / abort / takeback share one shape, so register them in a loop.
const actions = [
{ path: "resign", run: resignAndPersist },
{ path: "draw/offer", run: offerDrawAndPersist },
{ path: "draw/accept", run: acceptDrawAndPersist },
{ path: "draw/decline", run: declineDrawAndPersist },
{ path: "abort", run: abortAndPersist },
{ path: "takeback/offer", run: offerTakebackAndPersist },
{ path: "takeback/accept", run: acceptTakebackAndPersist },
{ path: "takeback/decline", run: declineTakebackAndPersist },
] as const;

for (const a of actions) {
app.post(`/api/games/:id/${a.path}`, { preHandler: requireAuth }, async (req, reply) => {
const params = parse(IdParams, req.params, reply);
if (!params) return reply;


  const result = a.run(params.id, req.user!.id);
  if (!result.ok) return fail(reply, result.error);
  return { ok: true };
});


}
}
