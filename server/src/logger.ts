import pino from "pino";
import { config } from "./config.js";

interface ReqLike {
  method?: string;
  url?: string;
  host?: string;
  ip?: string;
  socket?: { remotePort?: number };
}
interface ResLike {
  statusCode?: number;
}

// One pino instance shared by Fastify (as `loggerInstance`) and by non-request code
// (scheduler, backups, websockets). Headers and bodies are never serialized, so
// cookies and passwords can't leak into logs.
export const logger = pino({
  level: process.env.VITEST ? "silent" : config.logLevel,
  base: { svc: "lilchess" },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ["*.password", "*.inviteCode", "*.password_hash", "*.cookie"],
    censor: "[redacted]",
  },
  serializers: {
    req: (req: ReqLike) => ({
      method: req.method,
      url: req.url,
      host: req.host,
      remoteAddress: req.ip,
      remotePort: req.socket?.remotePort,
    }),
    res: (res: ResLike) => ({ statusCode: res.statusCode }),
    err: pino.stdSerializers.err,
  },
});