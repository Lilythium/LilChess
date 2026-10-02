import type { WebSocket } from "ws";
import type { User } from "../auth/queries.js";
import { submitMove } from "../db/repositories/games.js";
import { subscribe, unsubscribe } from "./hub.js";
import { ClientMessageSchema } from "../validation.js";
import { RateWindow } from "../security/rateWindow.js";
import { logger } from "../logger.js";

const log = logger.child({ mod: "ws" });
type TrackedSocket = WebSocket & { isAlive?: boolean };

function send(socket: WebSocket, payload: unknown): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
}

export function handleGameConnection(
  socket: TrackedSocket,
  gameId: string,
  user: User,
  isPlayer: boolean,
): void {
  socket.isAlive = true;
  socket.on("pong", () => {
    socket.isAlive = true;
  });

  subscribe(gameId, socket);

  // per-socket flood control: 20 messages / 10s is far above real play
  const limiter = new RateWindow(10_000, 20);

  socket.on("message", (raw, isBinary) => {
    if (isBinary) return;
    if (!limiter.hit("msg")) {
      socket.close(1008, "rate limit exceeded");
      return;
    }

    let json: unknown;
    try {
      json = JSON.parse(raw.toString());
    } catch {
      return send(socket, { type: "error", error: "bad_json" });
    }

    // Validate BEFORE touching game logic: a non-string `uci` used to throw inside parseUci and crash the process.
    const msg = ClientMessageSchema.safeParse(json);
    if (!msg.success) return send(socket, { type: "error", error: "bad_message" });
    if (!isPlayer) return send(socket, { type: "error", error: "spectators_cannot_move" });

    try {
      const result = submitMove(gameId, user.id, msg.data.ply, msg.data.uci);
      if (!result.ok) send(socket, { type: "error", error: result.error });
    } catch (err) {
      log.error({ err, gameId, userId: user.id }, "ws move failed");
      send(socket, { type: "error", error: "internal_error" });
    }
  });

  const cleanup = () => unsubscribe(gameId, socket);
  socket.on("close", cleanup);
  socket.on("error", cleanup);
}