import { createHash, randomBytes } from "node:crypto";

export const NATIVE_WEBSOCKET_TICKET_TTL_MS = 30_000;
const MAX_ACTIVE_TICKETS = 10_000;

interface TicketRecord {
  /** Hash of the bearer session token, never the bearer token itself. */
  sessionTokenHash: string;
  expiresAt: number;
}

// Tickets are intentionally process-local, short lived and one use. LilChess currently runs a
// single server process; a future multi-process deployment must move this to a shared atomic store.
const tickets = new Map<string, TicketRecord>();

function ticketKey(ticket: string): string {
  return createHash("sha256").update(ticket).digest("hex");
}

function validTicket(ticket: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(ticket);
}

function liveRecord(ticket: string): { key: string; record: TicketRecord } | undefined {
  if (!validTicket(ticket)) return undefined;
  const key = ticketKey(ticket);
  const record = tickets.get(key);
  if (!record) return undefined;
  if (record.expiresAt <= Date.now()) {
    tickets.delete(key);
    return undefined;
  }
  return { key, record };
}

function purgeExpired(): void {
  const now = Date.now();
  for (const [key, record] of tickets) {
    if (record.expiresAt <= now) tickets.delete(key);
  }
}

/** Issue a ticket bound to the current validated session, not merely the user ID. */
export function issueNativeWebSocketTicket(sessionTokenHash: string): string {
  if (!/^[a-f\d]{64}$/i.test(sessionTokenHash)) throw new TypeError("Invalid session hash.");
  purgeExpired();
  if (tickets.size >= MAX_ACTIVE_TICKETS) throw new Error("Native WebSocket ticket capacity reached.");

  while (true) {
    const ticket = randomBytes(32).toString("base64url");
    const key = ticketKey(ticket);
    if (tickets.has(key)) continue;

    tickets.set(key, {
      sessionTokenHash,
      expiresAt: Date.now() + NATIVE_WEBSOCKET_TICKET_TTL_MS,
    });
    return ticket;
  }
}

/** A read-only check used before applying the narrowly scoped Capacitor Origin exception. */
export function hasNativeWebSocketTicket(ticket: string): boolean {
  return liveRecord(ticket) !== undefined;
}

/** Consume once; subsequent attempts and expired tickets return undefined. */
export function consumeNativeWebSocketTicket(ticket: string): string | undefined {
  const live = liveRecord(ticket);
  if (!live) return undefined;
  tickets.delete(live.key);
  return live.record.sessionTokenHash;
}
