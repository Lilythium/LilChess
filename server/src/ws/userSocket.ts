import type { WebSocket } from "ws";
import type { User } from "../auth/queries.js";
import { subscribeUser, unsubscribeUser } from "./hub.js";

type TrackedSocket = WebSocket & { isAlive?: boolean };

// Server-push only (tournament pairings today). Anything the client sends is ignored.
export function handleUserConnection(socket: TrackedSocket, user: User): void {
  socket.isAlive = true;
  socket.on("pong", () => {
    socket.isAlive = true;
  });

  subscribeUser(user.id, socket);

  const cleanup = () => unsubscribeUser(user.id, socket);
  socket.on("close", cleanup);
  socket.on("error", cleanup);
}