import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { VARIANTS } from "@lilchess/shared";
import { requireAuth } from "../auth/routes.js";
import { config } from "../config.js";
import { parse } from "../validation.js";
import { MIN_PERIOD_GAMES, PERIODS, periodBoards, topPlayers } from "./queries.js";

const Params = z.object({ variant: z.enum(VARIANTS) });
const Query = z.object({ period: z.enum(PERIODS).default("week") });

export async function leaderboardRoutes(app: FastifyInstance) {
  app.get("/api/leaderboard/:variant", { preHandler: requireAuth }, async (req, reply) => {
    const params = parse(Params, req.params, reply);
    if (!params) return reply;
    const query = parse(Query, req.query, reply);
    if (!query) return reply;

    const opts = { minGames: config.leaderboardMinGames, inactiveDays: config.leaderboardInactiveDays };
    const { players, ranked } = topPlayers(params.variant, opts);
    const { improved, active } = periodBoards(params.variant, query.period, opts);

    void reply.header("cache-control", "no-store");
    return {
      ok: true,
      variant: params.variant,
      period: query.period,
      minGames: opts.minGames,
      inactiveDays: opts.inactiveDays,
      minPeriodGames: MIN_PERIOD_GAMES,
      ranked,
      top: players,
      improved,
      active,
    };
  });
}