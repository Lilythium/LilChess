import {
  claimTimeoutAndPersist,
  getEarliestActiveDeadline,
  getExpiredStartedGameIds,
} from "../db/repositories/games.js";
import { deadlineBus } from "./deadlineBus.js";
import { sendWebhook } from "../notifications/webhook.js";
import { getNextTournamentStartAt, repairStalledTournaments, startScheduledTournaments } from "../tournaments/service.js";
import { notifyTournamentCancelled, notifyTournamentStarting } from "../notifications/dispatch.js";
import { logger } from "../logger.js";
const log = logger.child({ mod: "timeouts" });

const TOURNAMENT_REPAIR_EVERY_MS = 30_000;
let lastTournamentRepair = 0;

const IDLE_POLL_MS = 60_000; 
const MIN_DELAY_MS = 50;

export function delayFor(msUntil: number): number {
  if (msUntil <= 0) return 0;
  if (msUntil > 60_000) return Math.min(msUntil, 30_000);
  if (msUntil > 10_000) return Math.min(msUntil, 2_000);
  if (msUntil > 2_000) return Math.min(msUntil, 500);
  return Math.max(MIN_DELAY_MS, Math.min(msUntil, 100));
}

let timer: NodeJS.Timeout | undefined;
let running = false;

function settleExpired(): void {
  for (const id of getExpiredStartedGameIds(Date.now())) {
    try {
      const result = claimTimeoutAndPersist(id, Date.now());
        if (result.ok) {
          if (result.state.status === "aborted") {
            log.info({ gameId: id }, "game aborted (no first move)");
        } else {
          log.info({ gameId: id, result: result.state.result }, "game timed out");
          void sendWebhook(`Game ${id} timed out (${result.state.result}).`);
        }
      }
    } catch (err) {
      log.error({ err, gameId: id }, "failed to settle expired game");
    }
  }
}

function tick(): void {
  if (!running) return;

  let delay = IDLE_POLL_MS;
  try {
    settleExpired();
    const now = Date.now();
    const { started, cancelled } = startScheduledTournaments(now);
    for (const tournamentId of started) notifyTournamentStarting(tournamentId);
    for (const tournamentId of cancelled) notifyTournamentCancelled(tournamentId);

    if (now - lastTournamentRepair >= TOURNAMENT_REPAIR_EVERY_MS) {
      lastTournamentRepair = now;
      repairStalledTournaments();
    }

    const deadlines = [getEarliestActiveDeadline(), getNextTournamentStartAt(now)]
      .filter((deadline): deadline is number => deadline !== undefined);
    if (deadlines.length) delay = delayFor(Math.min(...deadlines) - now);
  } catch (err) {
    log.error({ err }, "scheduler tick failed, retrying in 1s");
    delay = 1_000;
  }

  clearTimeout(timer);
  timer = setTimeout(tick, delay);
  timer.unref?.();
}

export function startTimeoutScheduler(): void {
  running = true;
  deadlineBus.on("changed", tick);
  tick(); 
}

export function stopTimeoutScheduler(): void {
  running = false;
  deadlineBus.off("changed", tick);
  if (timer) clearTimeout(timer);
}