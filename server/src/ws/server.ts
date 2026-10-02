import type { Duplex } from "node:stream";
import type { FastifyInstance } from "fastify";
import { WebSocketServer, type WebSocket } from "ws";
import { authenticateUpgrade, isAllowedOrigin } from "./upgradeAuth.js";
import { handleGameConnection } from "./gameSocket.js";
import { getParticipants } from "../db/repositories/games.js";
import { RateWindow } from "../security/rateWindow.js";
import { clientIp } from "../security/clientIp.js";
import { logger } from "../logger.js";

const log = logger.child({ mod: "ws" });
const HEARTBEAT_INTERVAL_MS = 30_000;
const GAME_WS_PATH = /^\/ws\/games\/([0-9a-f]{8,16})$/i;
const MAX_PAYLOAD_BYTES = 1024; // moves are ~40 bytes; ws defaults to 100 MiB
const UPGRADES_PER_MINUTE = 120;
const CLOSE_GRACE_MS = 2_000;

function reject(socket: Duplex, status: number, text: string): void {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

export function attachWebSocketServer(app: FastifyInstance): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });
  const upgradeLimiter = new RateWindow(60_000, UPGRADES_PER_MINUTE);

  app.server.on("upgrade", (req, socket, head) => {
    socket.on("error", () => socket.destroy()); // an unhandled socket 'error' would crash the process

    try {
      if (!upgradeLimiter.hit(clientIp(req))) return reject(socket, 429, "Too Many Requests");
      if (!isAllowedOrigin(req)) return reject(socket, 403, "Forbidden");

      const path = (req.url ?? "").split("?")[0] ?? "";
      const match = GAME_WS_PATH.exec(path);
      if (!match) return reject(socket, 404, "Not Found");
      const gameId = match[1]!;

      const user = authenticateUpgrade(req);
      if (!user) return reject(socket, 401, "Unauthorized");

      const p = getParticipants(gameId);
      if (!p) return reject(socket, 404, "Not Found");
      // Any logged-in user may watch; only the two players may send moves.
      const isPlayer = p.whiteId === user.id || p.blackId === user.id;

      wss.handleUpgrade(req, socket, head, (ws) => {
        handleGameConnection(ws as WebSocket & { isAlive?: boolean }, gameId, user, isPlayer);
      });

      wss.handleUpgrade(req, socket, head, (ws) => {
        handleGameConnection(ws as WebSocket & { isAlive?: boolean }, gameId, user);
      });
    } catch (err) {
      log.error({ err }, "upgrade failed");
      reject(socket, 500, "Internal Server Error");
    }
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

  // On app.close(): tell clients to go away (1001) so their reconnect logic takes over,
  // then force-terminate stragglers. Without this, the HTTP server waits forever on open sockets.
  app.addHook("onClose", (_instance, done) => {
    clearInterval(interval);
    const force = setTimeout(() => {
      for (const ws of wss.clients) ws.terminate();
    }, CLOSE_GRACE_MS);
    force.unref();

    for (const ws of wss.clients) ws.close(1001, "server shutting down");
    wss.close(() => {
      clearTimeout(force);
      done();
    });
  });
}