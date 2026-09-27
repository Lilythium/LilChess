import type { FastifyInstance } from "fastify";
import { WebSocketServer, type WebSocket } from "ws";
import { authenticateUpgrade, isAllowedOrigin } from "./upgradeAuth.js";
import { handleGameConnection } from "./gameSocket.js";
import { getParticipants } from "../db/repositories/games.js";

const HEARTBEAT_INTERVAL_MS = 30_000;
const GAME_WS_PATH = /^\/ws\/games\/([^/]+)$/;

export function attachWebSocketServer(app: FastifyInstance): void {
  const wss = new WebSocketServer({ noServer: true });

  app.server.on("upgrade", (req, socket, head) => {
    if (!isAllowedOrigin(req)) {
      socket.destroy();
      return;
    }

    const path = (req.url ?? "").split("?")[0] ?? "";
    const match = GAME_WS_PATH.exec(path);
    if (!match) {
      socket.destroy();
      return;
    }
    const gameId = match[1]!;

    const user = authenticateUpgrade(req);
    if (!user) {
      socket.destroy();
      return;
    }

    const p = getParticipants(gameId);
    if (!p || (p.whiteId !== user.id && p.blackId !== user.id)) {
      // Not found, or authenticated but not a player in this game.
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      handleGameConnection(ws as WebSocket & { isAlive?: boolean }, gameId, user);
    });
  });

  const interval = setInterval(() => {
    for (const ws of wss.clients) {
      const socket = ws as WebSocket & { isAlive?: boolean };
      if (socket.isAlive === false) {
        socket.terminate();
        continue;
      }
      socket.isAlive = false;
      socket.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);

  app.addHook("onClose", (_instance, done) => {
    clearInterval(interval);
    wss.close();
    done();
  });
}