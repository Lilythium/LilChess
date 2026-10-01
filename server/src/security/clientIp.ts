import type { IncomingMessage } from "node:http";
import { config } from "../config.js";

export function clientIp(req: IncomingMessage): string {
  const direct = req.socket.remoteAddress ?? "unknown";
  const tp = config.trustProxy;
  if (!tp || typeof tp === "string") return direct;

  const header = req.headers["x-forwarded-for"];
  const raw = Array.isArray(header) ? header.join(",") : header;
  const chain = raw?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  if (chain.length === 0) return direct;

  const hops = tp === true ? chain.length : tp;
  return chain[Math.max(0, chain.length - hops)] ?? direct;
}