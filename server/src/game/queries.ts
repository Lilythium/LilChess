import { getDb } from "../db/connection.js";
import { randomBytes } from "node:crypto";
import { fenAfterMoves, startingDeadline, START_FEN, type ClockConfig } from "@lilchess/shared";

// Helper to generate short random IDs like "aB9x2p"
function generateId(bytes = 4) {
  return randomBytes(bytes).toString("hex");
}

export class ChallengeError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ChallengeError";
    this.status = status;
  }
}

export const MAX_OPEN_CHALLENGES = 10;

export function countOpenChallengesFrom(userId: number): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM challenges WHERE from_user = ? AND expires_at > ?`)
    .get(userId, Date.now()) as { n: number };
  return row.n;
}

function attachPositions<T extends { id: string }>(
  rows: T[],
): (T & { fen: string; last_move: string | null })[] {
  if (rows.length === 0) return [];
  const db = getDb();
  const ids = rows.map((r) => r.id);
  const marks = ids.map(() => "?").join(",");

  const initialFens = new Map(
    (db.prepare(`SELECT id, initial_fen FROM games WHERE id IN (${marks})`).all(...ids) as
      { id: string; initial_fen: string }[]).map((r) => [r.id, r.initial_fen]),
  );

  const movesByGame = new Map<string, string[]>();
  const moveRows = db
    .prepare(`SELECT game_id, uci FROM moves WHERE game_id IN (${marks}) ORDER BY game_id, ply`)
    .all(...ids) as { game_id: string; uci: string }[];
  for (const m of moveRows) {
    const list = movesByGame.get(m.game_id) ?? [];
    list.push(m.uci);
    movesByGame.set(m.game_id, list);
  }

  return rows.map((r) => {
    const moves = movesByGame.get(r.id) ?? [];
    const fen = fenAfterMoves(initialFens.get(r.id) ?? START_FEN, moves) ?? START_FEN;
    return { ...r, fen, last_move: moves.at(-1) ?? null };
  });
}

export function createChallenge(data: {
  fromUser: number;
  toUser?: number;
  mode: string;
  initialMs?: number;
  incrementMs?: number;
  daysPerMove?: number;
  colorPref?: string;
}) {
  const id = generateId();
  const now = Date.now();
  // Expires in 1 hour
  const expiresAt = now + 60 * 60 * 1000;

  getDb().prepare(`
    INSERT INTO challenges (id, from_user, to_user, mode, initial_ms, increment_ms, days_per_move, color_pref, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, data.fromUser, data.toUser ?? null, data.mode, 
    data.initialMs ?? null, data.incrementMs ?? null, data.daysPerMove ?? null, 
    data.colorPref ?? null, now, expiresAt
  );

  return id;
}

export function acceptChallengeTx(challengeId: string, acceptingUserId: number) {
  const db = getDb();
  
  // Wrap in a transaction that runs strictly as BEGIN IMMEDIATE to prevent races
  const transaction = db.transaction(() => {
    const challenge = db.prepare(`SELECT * FROM challenges WHERE id = ?`).get(challengeId) as any;
    if (!challenge) throw new ChallengeError("Challenge not found or already accepted", 404);
    if (challenge.expires_at < Date.now()) {
      // (the hourly purge in maintenance.ts removes it; a DELETE here would be rolled back by the throw anyway)
      throw new ChallengeError("Challenge expired", 410);
    }
    if (challenge.from_user === acceptingUserId) throw new ChallengeError("Cannot accept your own challenge", 400);
    if (challenge.to_user && challenge.to_user !== acceptingUserId) throw new ChallengeError("Not invited to this challenge", 403);

    // Determine colors
    let whiteId = challenge.from_user;
    let blackId = acceptingUserId;
    if (challenge.color_pref === "black" || (challenge.color_pref !== "white" && Math.random() > 0.5)) {
      whiteId = acceptingUserId;
      blackId = challenge.from_user;
    }

    const gameId = generateId(5); // slightly longer ID for games
    const now = Date.now();
    const initialFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

    // Set initial clock deadline based on mode
    const clock: ClockConfig =
      challenge.mode === "live"
        ? { mode: "live", initialMs: challenge.initial_ms, incrementMs: challenge.increment_ms ?? 0 }
        : { mode: "correspondence", daysPerMove: challenge.days_per_move };
    const deadlineAt = startingDeadline(clock, now);

    db.prepare(`
      INSERT INTO games (
        id, white_id, black_id, variant, mode, initial_ms, increment_ms, days_per_move, 
        status, initial_fen, ply, white_ms, black_ms, turn_started_at, deadline_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      gameId, whiteId, blackId, "standard", challenge.mode, challenge.initial_ms, challenge.increment_ms, 
      challenge.days_per_move, "started", initialFen, 0, challenge.initial_ms ?? 0, challenge.initial_ms ?? 0, 
      now, deadlineAt, now
    );

    // Delete the consumed challenge
    db.prepare(`DELETE FROM challenges WHERE id = ?`).run(challengeId);

    return gameId;
  });

  // Execute the transaction
  return transaction.immediate();
}

// Fetch games for a specific user, categorized by turn
export function getMyGames(userId: number) {
  const games = getDb().prepare(`
    SELECT g.*, wu.username AS white_name, bu.username AS black_name
    FROM games g
    JOIN users wu ON wu.id = g.white_id
    JOIN users bu ON bu.id = g.black_id
    WHERE g.white_id = ? OR g.black_id = ?
    ORDER BY g.deadline_at ASC, g.created_at DESC
  `).all(userId, userId) as any[];

  const myTurn: any[] = [];
  const theirTurn: any[] = [];
  const finished: any[] = [];

  for (const game of games) {
    if (game.status === 'finished' || game.status === 'aborted') {
      finished.push(game);
      continue;
    }

    // Determine whose turn it is based on the ply (even = white, odd = black)
    const isWhiteToMove = game.ply % 2 === 0;
    const isMyTurn = (isWhiteToMove && game.white_id === userId) || (!isWhiteToMove && game.black_id === userId);

    if (isMyTurn) myTurn.push(game);
    else theirTurn.push(game);
  }

  finished.sort((a, b) => (b.ended_at ?? 0) - (a.ended_at ?? 0));
  return {
    myTurn: attachPositions(myTurn),
    theirTurn: attachPositions(theirTurn),
    finished: attachPositions(finished.slice(0, 50)),
  };
}

// Fetch user profile and Head-to-Head stats
export function getUserProfileWithH2H(targetUsername: string, viewerId: number) {
  const db = getDb();
  
  const targetUser = db.prepare(`SELECT id, username, created_at FROM users WHERE username = ?`).get(targetUsername) as any;
  if (!targetUser) return null;

  // If viewing someone else, calculate H2H stats
  let h2h = null;
  if (targetUser.id !== viewerId) {
    const stats = db.prepare(`
      SELECT 
        SUM(CASE WHEN (result = '1-0' AND white_id = :me) OR (result = '0-1' AND black_id = :me) THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN result = '1/2-1/2' THEN 1 ELSE 0 END) as draws,
        SUM(CASE WHEN (result = '1-0' AND white_id = :them) OR (result = '0-1' AND black_id = :them) THEN 1 ELSE 0 END) as losses
      FROM games
      WHERE status = 'finished'
        AND ((white_id = :me AND black_id = :them) OR (white_id = :them AND black_id = :me))
    `).get({ me: viewerId, them: targetUser.id }) as any;

    h2h = {
      wins: stats.wins || 0,
      draws: stats.draws || 0,
      losses: stats.losses || 0
    };
  }

  const games = db.prepare(`
    SELECT g.id, g.mode, g.initial_ms, g.increment_ms, g.days_per_move,
          g.result, g.termination, g.ended_at,
          g.white_id, g.black_id, wu.username AS white_name, bu.username AS black_name
    FROM games g
    JOIN users wu ON wu.id = g.white_id
    JOIN users bu ON bu.id = g.black_id
    WHERE g.status = 'finished' AND (g.white_id = ? OR g.black_id = ?)
    ORDER BY g.ended_at DESC LIMIT 20
  `).all(targetUser.id, targetUser.id) as any[];

  return { profile: targetUser, h2h, games: attachPositions(games) };
}

export function getGamePlayers(gameId: string) {
  return getDb().prepare(`
    SELECT g.white_id AS whiteId, wu.username AS whiteName,
           g.black_id AS blackId, bu.username AS blackName,
           g.created_at AS createdAt
    FROM games g
    JOIN users wu ON wu.id = g.white_id
    JOIN users bu ON bu.id = g.black_id
    WHERE g.id = ?
  `).get(gameId) as
    | { whiteId: number; whiteName: string; blackId: number; blackName: string; createdAt: number }
    | undefined;
}

export function listChallenges(userId: number) {
  const rows = getDb().prepare(`
    SELECT c.*, u.username AS from_name
    FROM challenges c JOIN users u ON u.id = c.from_user
    WHERE c.expires_at > ? AND (c.from_user = ? OR c.to_user IS NULL OR c.to_user = ?)
    ORDER BY c.created_at DESC
  `).all(Date.now(), userId, userId) as any[];
  return {
    mine: rows.filter((r) => r.from_user === userId),
    forMe: rows.filter((r) => r.to_user === userId),
    open: rows.filter((r) => r.from_user !== userId && r.to_user === null),
  };
}

export function cancelChallenge(id: string, userId: number): boolean {
  return getDb().prepare(`DELETE FROM challenges WHERE id = ? AND from_user = ?`)
    .run(id, userId).changes > 0;
}

// Games in progress, for the "Watch live" page. Live-clock games first, most recently active first.
export function getLiveGames(limit = 20) {
  const rows = getDb().prepare(`
    SELECT g.id, g.white_id, g.black_id, wu.username AS white_name, bu.username AS black_name,
           g.mode, g.initial_ms, g.increment_ms, g.days_per_move, g.ply, g.deadline_at
    FROM games g
    JOIN users wu ON wu.id = g.white_id
    JOIN users bu ON bu.id = g.black_id
    WHERE g.status = 'started'
    ORDER BY (g.mode = 'live') DESC, g.turn_started_at DESC
    LIMIT ?
  `).all(limit) as any[];
  return attachPositions(rows);
}