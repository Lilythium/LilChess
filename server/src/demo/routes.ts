import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { DEMO_BOT_USERNAME } from "./bot.js";
import { startDemoGame } from "./data.js";

export async function demoRoutes(app: FastifyInstance): Promise<void> {
  // Public (no session, no invite) so a first-time visitor or an app reviewer can play at once. It only ever
  // creates a guest, which cannot create challenges, play rated games or reach registered accounts, and a game
  // against the practice bot. Native clients only: the token is returned in the body and no cookie is set.
  app.post(
    "/api/native/demo",
    { config: { rateLimit: { max: 20, timeWindow: "1 hour" } } },
    async (req, reply) => {
      if (!config.demoMode) return reply.code(404).send({ error: "Not found" });
      const started = startDemoGame();
      if (!started) return reply.code(503).send({ error: "The demo is busy right now. Try again in a few minutes." });
      req.log.info({ userId: started.user.id, gameId: started.gameId }, "demo game started");
      return { ok: true, ...started, botName: DEMO_BOT_USERNAME };
    },
  );
}
