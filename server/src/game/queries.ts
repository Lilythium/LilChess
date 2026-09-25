import { getDb } from "../db/connection.js";
import { randomBytes } from "node:crypto";

// Helper to generate short random IDs like "aB9x2p"
function generateId(bytes = 4) {
  return randomBytes(bytes).toString("hex");
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
    if (!challenge) throw new Error("Challenge not found or already accepted");
    if (challenge.expires_at < Date.now()) {
      db.prepare(`DELETE FROM challenges WHERE id = ?`).run(challengeId);
      throw new Error("Challenge expired");
    }
    if (challenge.from_user === acceptingUserId) throw new Error("Cannot accept your own challenge");
    if (challenge.to_user && challenge.to_user !== acceptingUserId) throw new Error("Not invited to this challenge");

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
    let deadlineAt = 0;
    if (challenge.mode === "live") {
      deadlineAt = now + challenge.initial_ms;
    } else if (challenge.mode === "correspondence") {
      deadlineAt = now + (challenge.days_per_move * 24 * 60 * 60 * 1000);
    }

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
    SELECT * FROM games 
    WHERE (white_id = ? OR black_id = ?) 
    ORDER BY deadline_at ASC, created_at DESC
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

  return { myTurn, theirTurn, finished };
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

  return { profile: targetUser, h2h };
}