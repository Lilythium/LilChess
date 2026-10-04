import { config } from "./config.js";
import { logger } from "./logger.js";
import { buildApp } from "./app.js";
import { openDb, closeDb, getDb } from "./db/connection.js";
import { checkIntegrity } from "./db/integrity.js";
import { startTimeoutScheduler, stopTimeoutScheduler } from "./game/timeoutScheduler.js";
import { startBackupScheduler, stopBackupScheduler } from "./db/backup.js";
import { startMaintenance, stopMaintenance } from "./maintenance.js";

if (config.registration === "invite" && config.inviteCode === "changeme") {
  logger.warn("INVITE_CODE is still the example value 'changeme'");
}
if (config.nodeEnv === "production" && !config.baseOrigin) {
  logger.warn("BASE_URL is not set: Origin checks fall back to the Host header and cookies are Secure by NODE_ENV only");
}

openDb(`${config.dataDir}/lilchess.db`);
for (const issue of checkIntegrity(getDb())) logger.warn(issue, "database integrity issue");
startTimeoutScheduler(); // also sweeps games that expired while the server was down
startMaintenance();
if (config.backupKeep > 0) {
  startBackupScheduler({ dir: config.backupDir, keep: config.backupKeep, hourUtc: config.backupHourUtc });
}

const app = await buildApp();

let shuttingDown = false;
async function shutdown(reason: string, exitCode = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ reason }, "shutting down");

  const force = setTimeout(() => {
    logger.error("shutdown timed out, forcing exit");
    process.exit(1);
  }, 10_000);
  force.unref();

  try {
    stopTimeoutScheduler();
    stopMaintenance();
    await stopBackupScheduler(); // lets an in-flight backup finish
    await app.close(); // stops accepting connections, closes WebSockets (hook in ws/server.ts), drains requests
    closeDb(); // checkpoints the WAL, then closes
    logger.info("shutdown complete");
  } catch (err) {
    logger.error({ err }, "error during shutdown");
    exitCode = 1;
  }
  process.exit(exitCode);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "uncaught exception");
  void shutdown("uncaughtException", 1);
});
process.on("unhandledRejection", (err) => {
  logger.fatal({ err }, "unhandled rejection");
  void shutdown("unhandledRejection", 1);
});

try {
  await app.listen({ port: config.port, host: config.host });
} catch (err) {
  logger.fatal({ err }, "failed to start");
  process.exit(1);
}