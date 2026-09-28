import {
  claimTimeoutAndPersist,
  getEarliestActiveDeadline,
  getExpiredStartedGameIds,
} from "../db/repositories/games.js";
import { deadlineBus } from "./deadlineBus.js";
import { sendWebhook } from "../notifications/webhook.js";


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
    const result = claimTimeoutAndPersist(id, Date.now());
    if (result.ok) void sendWebhook(`Game ${id} timed out (${result.state.result}).`);
  }
}

function tick(): void {
  if (!running) return;
  settleExpired();

  const deadline = getEarliestActiveDeadline();
  const delay = deadline === undefined ? IDLE_POLL_MS : delayFor(deadline - Date.now());

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