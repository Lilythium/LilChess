import type { WebSocket } from "ws";
import { subscribeSimul, unsubscribeSimul } from "./hub.js";

type TrackedSocket = WebSocket & { isAlive?: boolean };

// Server-push only: everything the client sends is ignored. Spectators are welcome.
export function handleSimulConnection(socket: TrackedSocket, simulId: string): void {
  socket.isAlive = true;
  socket.on("pong", () => {
    socket.isAlive = true;
  });

  subscribeSimul(simulId, socket);

  const cleanup = () => unsubscribeSimul(simulId, socket);
  socket.on("close", cleanup);
  socket.on("error", cleanup);
}