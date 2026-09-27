import type { WebSocket } from "ws";
import type { ClientMessage } from "@lilchess/shared";
import type { User } from "../auth/queries.js";
import { submitMove } from "../db/repositories/games.js";
import { subscribe, unsubscribe } from "./hub.js";

type TrackedSocket = WebSocket & { isAlive?: boolean };

export function handleGameConnection(socket: TrackedSocket, gameId: string, user: User): void {
  socket.isAlive = true;
  socket.on("pong", () => {
    socket.isAlive = true;
  });

  subscribe(gameId, socket);

  socket.on("message", (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === "move") {
      const result = submitMove(gameId, user.id, msg.ply, msg.uci);
      if (!result.ok) {
        socket.send(JSON.stringify({ type: "error", error: result.error }));
      }
    }
  });

  const cleanup = () => unsubscribe(gameId, socket);
  socket.on("close", cleanup);
  socket.on("error", cleanup);
}