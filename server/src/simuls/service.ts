import { randomBytes } from "node:crypto";
import {
  createGame, hostColorForSeat, MAX_SIMUL_INVITES, simulFirstMoveWindowMs, simulScore,
  type Color, type ClockConfig, type HostColor, type SimulStatus, type Variant,
} from "@lilchess/shared";
import { getUserByUsername } from "../auth/queries.js";
import { getDb } from "../db/connection.js";
import { insertGame } from "../db/repositories/insertGame.js";
import {
  discardQueuedSimulEvents, flushSimulEvents, queueSimulEvent, queueSimulUserEvent,
} from "./events.js";
import { canViewSimul } from "./lookup.js";

export class SimulError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "SimulError";
  }
}

interface SimulRow {
  id: string; host_id: number; name: string; status: SimulStatus; mode: "live" | "correspondence";
  initial_ms: number | null; increment_ms: number | null; days_per_move: number | null;
  host_extra_ms: number; variant: Variant; host_color: HostColor; max_players: number;
  created_at: number; started_at: number | null; ended_at: number | null;
}

const loadSimul = (id: string) => getDb().prepare(`SELECT * FROM simuls WHERE id = ?`).get(id) as SimulRow | undefined;

/** Runs `work` in one immediate transaction, then pushes whatever it queued. A failure discards the queue. */
function commit<T>(work: () => T): T {
  try {
    const result = getDb().transaction(work).immediate();
    flushSimulEvents();
    return result;
  } catch (err) {
    discardQueuedSimulEvents();
    throw err;
  }
}

export interface SimulConfig {
  name: string;
  mode: "live" | "correspondence";
  initialMs?: number;
  incrementMs?: number;
  daysPerMove?: number;
  hostExtraMs: number;
  variant: Variant;
  hostColor: HostColor;
  maxPlayers: number;
}

export function createSimul(hostId: number, c: SimulConfig, now = Date.now()): string {
  const id = randomBytes(8).toString("hex");
  try {
    getDb().prepare(`
      INSERT INTO simuls (id, host_id, name, mode, initial_ms, increment_ms, days_per_move,
                          host_extra_ms, variant, host_color, max_players, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, hostId, c.name, c.mode,
      c.mode === "live" ? c.initialMs : null,
      c.mode === "live" ? c.incrementMs ?? 0 : null,
      c.mode === "correspondence" ? c.daysPerMove : null,
      c.hostExtraMs, c.variant, c.hostColor, c.maxPlayers, now,
    );
  } catch (err) {
    if ((err as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE") {
      throw new SimulError("You already have an open or running simul", 409);
    }
    throw err;
  }
  return id;
}

export interface InviteResult {
  invited: { id: number; username: string }[];
  skipped: { username: string; reason: string }[];
}

/** Partial success on purpose: a typo in one name of twenty shouldn't throw the other nineteen away. */
export function inviteToSimul(simulId: string, hostId: number, usernames: string[], now = Date.now()): InviteResult {
  return commit(() => {
    const db = getDb();
    const simul = loadSimul(simulId);
    if (!simul) throw new SimulError("Simul not found", 404);
    if (simul.host_id !== hostId) throw new SimulError("Only the host can invite players", 403);
    if (simul.status !== "open") throw new SimulError("This simul is no longer taking invitations", 409);

    const host = db.prepare(`SELECT username FROM users WHERE id = ?`).get(hostId) as { username: string };
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM simul_players WHERE simul_id = ?`).get(simulId) as { n: number }).n;
    let room = MAX_SIMUL_INVITES - total;

    const result: InviteResult = { invited: [], skipped: [] };
    const skip = (username: string, reason: string) => result.skipped.push({ username, reason });

    for (const username of new Set(usernames)) {
      const user = getUserByUsername(username);
      if (!user) { skip(username, "No such user"); continue; }
      if (user.id === hostId) { skip(username, "That's you"); continue; }
      if (user.is_guest) { skip(username, "Guests can't join simuls"); continue; }
      if (db.prepare(`SELECT 1 FROM simul_players WHERE simul_id = ? AND user_id = ?`).get(simulId, user.id)) {
        skip(username, "Already invited"); continue;
      }
      if (room <= 0) { skip(username, "Invitation limit reached"); continue; }

      db.prepare(`INSERT INTO simul_players (simul_id, user_id, invited_at) VALUES (?, ?, ?)`).run(simulId, user.id, now);
      room--;
      result.invited.push({ id: user.id, username: user.username });
      queueSimulUserEvent(user.id, { type: "simul_invite", simulId, name: simul.name, hostName: host.username });
    }
    if (result.invited.length) queueSimulEvent({ type: "simul_roster", simulId });
    return result;
  });
}

/** While the simul is open an invitee can change their mind as often as they like. */
export function respondToInvite(simulId: string, userId: number, accept: boolean, now = Date.now()): void {
  commit(() => {
    const db = getDb();
    const simul = loadSimul(simulId);
    const me = db.prepare(`SELECT status FROM simul_players WHERE simul_id = ? AND user_id = ?`)
      .get(simulId, userId) as { status: string } | undefined;
    if (!simul || !me) throw new SimulError("You have not been invited to this simul", 404);
    if (simul.status !== "open") throw new SimulError("This simul has already started or was cancelled", 409);

    const next = accept ? "accepted" : "declined";
    if (me.status === next) return; // keeps the acceptance order (= board order) stable

    if (accept) {
      const accepted = (db.prepare(`SELECT COUNT(*) AS n FROM simul_players WHERE simul_id = ? AND status = 'accepted'`)
        .get(simulId) as { n: number }).n;
      if (accepted >= simul.max_players) throw new SimulError("This simul is full", 409);
    }
    db.prepare(`UPDATE simul_players SET status = ?, responded_at = ? WHERE simul_id = ? AND user_id = ?`)
      .run(next, now, simulId, userId);
    queueSimulEvent({ type: "simul_roster", simulId });
  });
}

/** Creates one ordinary game per accepted player. Returns the number of boards. */
export function startSimul(simulId: string, hostId: number, now = Date.now()): number {
  return commit(() => {
    const db = getDb();
    const simul = loadSimul(simulId);
    if (!simul) throw new SimulError("Simul not found", 404);
    if (simul.host_id !== hostId) throw new SimulError("Only the host can start this simul", 403);
    if (simul.status !== "open") throw new SimulError("This simul has already started or was cancelled", 409);

    const accepted = db.prepare(`
      SELECT user_id AS userId FROM simul_players
      WHERE simul_id = ? AND status = 'accepted' ORDER BY responded_at, user_id
    `).all(simulId) as { userId: number }[];
    if (accepted.length === 0) throw new SimulError("At least one player has to accept before you can start", 409);

    const clock: ClockConfig = simul.mode === "live"
      ? { mode: "live", initialMs: simul.initial_ms!, incrementMs: simul.increment_ms ?? 0 }
      : { mode: "correspondence", daysPerMove: simul.days_per_move! };
    const firstMoveMs = simulFirstMoveWindowMs(accepted.length);
    const setGame = db.prepare(`UPDATE simul_players SET seat = ?, game_id = ? WHERE simul_id = ? AND user_id = ?`);

    accepted.forEach(({ userId }, index) => {
      const seat = index + 1;
      const hostColor: Color = hostColorForSeat(seat, simul.host_color);
      let game = createGame({ clock, now, variant: simul.variant, rated: false });
      if (simul.mode === "live") {
        game = {
          ...game,
          whiteMs: game.whiteMs + (hostColor === "white" ? simul.host_extra_ms : 0),
          blackMs: game.blackMs + (hostColor === "black" ? simul.host_extra_ms : 0),
          // The host needs time to walk the boards: a longer window for the first move only (see simul.ts).
          deadlineAt: now + firstMoveMs,
        };
      }
      const gameId = randomBytes(5).toString("hex");
      insertGame(gameId, hostColor === "white" ? hostId : userId, hostColor === "white" ? userId : hostId, game);
      setGame.run(seat, gameId, simulId, userId);
      if (simul.mode === "live") queueSimulUserEvent(userId, { type: "simul_started", simulId, gameId });
    });

    db.prepare(`UPDATE simuls SET status = 'running', started_at = ? WHERE id = ?`).run(now, simulId);
    queueSimulEvent({ type: "simul_state", simulId, status: "running" });
    return accepted.length;
  });
}

export function cancelSimul(simulId: string, hostId: number, now = Date.now()): void {
  commit(() => {
    const simul = loadSimul(simulId);
    if (!simul) throw new SimulError("Simul not found", 404);
    if (simul.host_id !== hostId) throw new SimulError("Only the host can cancel this simul", 403);
    if (simul.status !== "open") throw new SimulError("Only a simul that hasn't started can be cancelled", 409);
    getDb().prepare(`UPDATE simuls SET status = 'cancelled', ended_at = ? WHERE id = ?`).run(now, simulId);
    queueSimulEvent({ type: "simul_state", simulId, status: "cancelled" });
  });
}

// ---- reads ----

export function getSimulDetail(simulId: string, viewerId: number) {
  if (!canViewSimul(simulId, viewerId)) return undefined;
  const db = getDb();
  const simul = db.prepare(`
    SELECT s.*, u.username AS host_name FROM simuls s JOIN users u ON u.id = s.host_id WHERE s.id = ?
  `).get(simulId) as (SimulRow & { host_name: string }) | undefined;
  if (!simul) return undefined;

  const players = db.prepare(`
    SELECT sp.user_id AS userId, u.username, sp.status, sp.seat, sp.game_id AS gameId
    FROM simul_players sp JOIN users u ON u.id = sp.user_id
    WHERE sp.simul_id = ?
    ORDER BY sp.seat IS NULL, sp.seat, sp.invited_at, sp.user_id
  `).all(simulId) as { userId: number; username: string; status: string; seat: number | null; gameId: string | null }[];

  const boards = (db.prepare(`
    SELECT sp.seat, sp.user_id AS userId, u.username, g.id AS gameId, g.white_id AS whiteId, g.status, g.result,
           g.termination, g.ply, g.fen, g.last_move AS lastMove, g.white_ms AS whiteMs, g.black_ms AS blackMs,
           g.deadline_at AS deadlineAt, g.draw_offered_by AS drawOfferedBy
    FROM simul_players sp
    JOIN users u ON u.id = sp.user_id
    JOIN games g ON g.id = sp.game_id
    WHERE sp.simul_id = ? ORDER BY sp.seat
  `).all(simulId) as any[]).map(({ whiteId, ...b }) => ({
    ...b,
    hostColor: (whiteId === simul.host_id ? "white" : "black") as Color,
    turn: (b.ply % 2 === 0 ? "white" : "black") as Color,
    drawOfferedBy: (b.drawOfferedBy ?? null) as Color | null,
  }));

  const me = players.find((p) => p.userId === viewerId);
  return {
    simul: {
      id: simul.id, name: simul.name, status: simul.status, mode: simul.mode, variant: simul.variant,
      hostId: simul.host_id, hostName: simul.host_name, initialMs: simul.initial_ms,
      incrementMs: simul.increment_ms, daysPerMove: simul.days_per_move, hostExtraMs: simul.host_extra_ms,
      hostColor: simul.host_color, maxPlayers: simul.max_players, createdAt: simul.created_at,
      startedAt: simul.started_at, endedAt: simul.ended_at,
    },
    players,
    boards,
    score: simulScore(boards),
    viewer: { isHost: simul.host_id === viewerId, invite: me?.status ?? null, gameId: me?.gameId ?? null },
    serverNow: Date.now(),
  };
}

const SUMMARY = `
  s.id, s.name, s.status, s.mode, s.variant, s.host_id AS hostId, hu.username AS hostName,
  s.initial_ms AS initialMs, s.increment_ms AS incrementMs, s.days_per_move AS daysPerMove,
  s.max_players AS maxPlayers, s.created_at AS createdAt,
  (SELECT COUNT(*) FROM simul_players p WHERE p.simul_id = s.id AND p.status = 'accepted') AS accepted,
  (SELECT COUNT(*) FROM simul_players p JOIN games g ON g.id = p.game_id
    WHERE p.simul_id = s.id AND g.status = 'started') AS boardsLeft,
  (SELECT COUNT(*) FROM simul_players p JOIN games g ON g.id = p.game_id
    WHERE p.simul_id = s.id AND g.status = 'started'
      AND ((g.ply % 2 = 0 AND g.white_id = s.host_id) OR (g.ply % 2 = 1 AND g.black_id = s.host_id))) AS boardsToMove,
  (SELECT p.game_id FROM simul_players p JOIN games g ON g.id = p.game_id
    WHERE p.simul_id = s.id AND p.user_id = @viewer AND g.status = 'started') AS viewerGameId
`;

export function listSimuls(viewerId: number) {
  const db = getDb();
  const from = `FROM simuls s JOIN users hu ON hu.id = s.host_id`;
  const params = { viewer: viewerId };
  return {
    hosting: db.prepare(`
      SELECT ${SUMMARY}, NULL AS myStatus ${from}
      WHERE s.host_id = @viewer AND s.status IN ('open', 'running') LIMIT 1
    `).get(params) ?? null,
    invitations: db.prepare(`
      SELECT ${SUMMARY}, me.status AS myStatus ${from}
      JOIN simul_players me ON me.simul_id = s.id AND me.user_id = @viewer AND me.status IN ('invited', 'accepted')
      WHERE s.status = 'open' ORDER BY s.created_at DESC
    `).all(params),
    running: db.prepare(`
      SELECT ${SUMMARY}, NULL AS myStatus ${from} WHERE s.status = 'running' ORDER BY s.started_at DESC LIMIT 20
    `).all(params),
    recent: db.prepare(`
      SELECT ${SUMMARY}, NULL AS myStatus ${from} WHERE s.status = 'completed' ORDER BY s.ended_at DESC LIMIT 10
    `).all(params),
  };
}