import { getDb } from "../db/connection.js";
import { randomBytes } from "node:crypto";
import { makeFen } from "chessops/fen";
import { parsePgn, startingPosition } from "chessops/pgn";
import { parseSan } from "chessops/san";
import { makeUci } from "chessops/util";
import { createGame, normalizeUsername, type ClockConfig, type GameState, type Variant } from "@lilchess/shared";
import { insertGame, headToHead } from "../db/repositories/games.js";
import { getPlayerRatings, getRatingHistory, getRatingBadge } from "../db/repositories/ratings.js";

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

const HOUR_MS = 60 * 60 * 1000;
export const LINK_TTL_MS = 24 * HOUR_MS;
export const LIVE_CHALLENGE_TTL_MS = HOUR_MS;
export const CORRESPONDENCE_CHALLENGE_TTL_MS = 48 * HOUR_MS;

export function challengeTtlMs(mode: string): number {
  return mode === "correspondence" ? CORRESPONDENCE_CHALLENGE_TTL_MS : LIVE_CHALLENGE_TTL_MS;
}

export function countOpenChallengesFrom(userId: number): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM challenges WHERE from_user = ? AND expires_at > ?`)
    .get(userId, Date.now()) as { n: number };
  return row.n;
}

export function createChallenge(data: {
  fromUser: number;
  toUser?: number;
  mode: string;
  initialMs?: number;
  incrementMs?: number;
  daysPerMove?: number;
  colorPref?: string;
  isLink?: boolean;
  rated?: boolean;
  variant?: Variant;
}) {
  const db = getDb();
  const id = generateId(data.isLink ? 8 : 4);
  const now = Date.now();
  const expiresAt = now + challengeTtlMs(data.mode);

  // A user has at most one challenge per mode: creating a new one replaces the old one.
  return db.transaction(() => {
    db.prepare(`DELETE FROM challenges WHERE from_user = ? AND mode = ?`).run(data.fromUser, data.mode);
    db.prepare(`
      INSERT INTO challenges (id, from_user, to_user, mode, initial_ms, increment_ms, days_per_move, color_pref, created_at, expires_at, is_link, variant)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, data.fromUser, data.toUser ?? null, data.mode,
      data.initialMs ?? null, data.incrementMs ?? null, data.daysPerMove ?? null,
      data.colorPref ?? null, now, expiresAt, data.isLink ? 1 : 0, data.variant ?? "standard",
    );

    return id;
  })();
}

export function acceptChallengeTx(challengeId: string, acceptingUserId: number) {
  const db = getDb();

  // Wrap in a transaction that runs strictly as BEGIN IMMEDIATE to prevent races
  const transaction = db.transaction(() => {
    const challenge = db.prepare(`SELECT * FROM challenges WHERE id = ?`).get(challengeId) as any;
    if (!challenge) throw new ChallengeError("Challenge not found or already accepted", 404);
    if (challenge.expires_at < Date.now()) {
      throw new ChallengeError("Challenge expired", 410);
    }
    if (challenge.from_user === acceptingUserId) throw new ChallengeError("Cannot accept your own challenge", 400);
    if (challenge.to_user && challenge.to_user !== acceptingUserId) throw new ChallengeError("Not invited to this challenge", 403);
    if (challenge.rated) {
      const me = db.prepare(`SELECT is_guest FROM users WHERE id = ?`).get(acceptingUserId) as { is_guest: number } | undefined;
      if (me?.is_guest) throw new ChallengeError("Guests can only play casual games. Register to play rated.", 403);
    }

    // Determine colors
    let whiteId = challenge.from_user;
    let blackId = acceptingUserId;
    if (challenge.color_pref === "black" || (challenge.color_pref !== "white" && Math.random() > 0.5)) {
      whiteId = acceptingUserId;
      blackId = challenge.from_user;
    }

    const gameId = generateId(5); // slightly longer ID for games
    const clock: ClockConfig =
      challenge.mode === "live"
        ? { mode: "live", initialMs: challenge.initial_ms, incrementMs: challenge.increment_ms ?? 0 }
        : { mode: "correspondence", daysPerMove: challenge.days_per_move };

    const variant: Variant = challenge.variant === "chess960" ? "chess960" : "standard";
    insertGame(gameId, whiteId, blackId, createGame({ clock, now: Date.now(), variant }));

    // Delete the consumed challenge
    db.prepare(`DELETE FROM challenges WHERE id = ?`).run(challengeId);

    return gameId;
  });

  // Execute the transaction
  return transaction.immediate();
}

const GAME_ROW_COLUMNS = `
  g.id, g.white_id, g.black_id, wu.username AS white_name, bu.username AS black_name,
  g.mode, g.initial_ms, g.increment_ms, g.days_per_move, g.status, g.result, g.termination,
  g.ply, g.deadline_at, g.ended_at, g.fen, g.last_move,
  (SELECT sp.simul_id FROM simul_players sp WHERE sp.game_id = g.id) AS simul_id,
  (SELECT s.host_id FROM simul_players sp JOIN simuls s ON s.id = sp.simul_id
    WHERE sp.game_id = g.id) AS simul_host_id`;

const GAME_ROW_FROM = `
  FROM games g
  JOIN users wu ON wu.id = g.white_id
  JOIN users bu ON bu.id = g.black_id`;

interface GameListRow {
  id: string;
  white_id: number;
  black_id: number;
  ply: number;
  [k: string]: unknown;
}

// Fetch games for a specific user, categorized by turn
export function getMyGames(userId: number) {
  const db = getDb();

  const active = db.prepare(`
    SELECT ${GAME_ROW_COLUMNS} ${GAME_ROW_FROM}
    WHERE g.status = 'started' AND (g.white_id = :me OR g.black_id = :me)
    ORDER BY g.deadline_at ASC, g.created_at DESC
  `).all({ me: userId }) as GameListRow[];

  const finished = db.prepare(`
    SELECT ${GAME_ROW_COLUMNS} ${GAME_ROW_FROM}
    WHERE g.status <> 'started' AND (g.white_id = :me OR g.black_id = :me)
    ORDER BY g.ended_at DESC LIMIT 50
  `).all({ me: userId }) as GameListRow[];

  const myTurn: GameListRow[] = [];
  const theirTurn: GameListRow[] = [];

  for (const g of active) {
    const whiteToMove = g.ply % 2 === 0;
    const mine = whiteToMove ? g.white_id === userId : g.black_id === userId;
    (mine ? myTurn : theirTurn).push(g);
  }

  return { myTurn, theirTurn, finished };
}

// Fetch user profile and Head-to-Head stats
export function getUserProfileWithH2H(targetUsername: string, viewerId: number) {
  const db = getDb();
  const targetUser = db.prepare(`SELECT id, username, created_at FROM users WHERE username = ?`).get(normalizeUsername(targetUsername)) as any;
  if (!targetUser) return null;

  const ratings = getPlayerRatings(targetUser.id);
  const history = getRatingHistory(targetUser.id);

  let h2h = null;
  if (targetUser.id !== viewerId) {
     const r = headToHead(viewerId, targetUser.id) as { wins: number | null; draws: number | null; losses: number | null };
     h2h = { wins: r.wins ?? 0, draws: r.draws ?? 0, losses: r.losses ?? 0 };
  }

  const games = db.prepare(`
    SELECT g.id, g.mode, g.initial_ms, g.increment_ms, g.days_per_move,
           g.result, g.termination, g.ended_at,
           g.white_id, g.black_id, wu.username AS white_name, bu.username AS black_name,
           g.fen, g.last_move
    FROM games g
    JOIN users wu ON wu.id = g.white_id
    JOIN users bu ON bu.id = g.black_id
    WHERE g.status = 'finished' AND (g.white_id = ? OR g.black_id = ?)
    ORDER BY g.ended_at DESC LIMIT 20
  `).all(targetUser.id, targetUser.id) as any[];

  return { profile: targetUser, ratings, history, h2h, games };
}

export function getGamePlayers(gameId: string) {
  const db = getDb();
  const g = db.prepare(`
    SELECT g.white_id AS whiteId, wu.username AS whiteName, wu.is_guest AS whiteIsGuest,
           g.black_id AS blackId, bu.username AS blackName, bu.is_guest AS blackIsGuest,
           g.created_at AS createdAt, g.variant
    FROM games g
    JOIN users wu ON wu.id = g.white_id
    JOIN users bu ON bu.id = g.black_id
    WHERE g.id = ?
  `).get(gameId) as any;

  if (!g) return undefined;

  return {
    whiteId: g.whiteId,
    whiteName: g.whiteName,
    whiteRating: g.whiteIsGuest ? null : getRatingBadge(g.whiteId, g.variant),
    blackId: g.blackId,
    blackName: g.blackName,
    blackRating: g.blackIsGuest ? null : getRatingBadge(g.blackId, g.variant),
    createdAt: g.createdAt,
  };
}

export function listChallenges(userId: number) {
  const rows = getDb().prepare(`
    SELECT c.*, u.username AS from_name
    FROM challenges c JOIN users u ON u.id = c.from_user
    WHERE c.expires_at > ?
      AND (c.from_user = ? OR (c.is_link = 0 AND (c.to_user IS NULL OR c.to_user = ?)))
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
           g.mode, g.initial_ms, g.increment_ms, g.days_per_move, g.ply, g.deadline_at, g.fen
    FROM games g
    JOIN users wu ON wu.id = g.white_id
    JOIN users bu ON bu.id = g.black_id
    WHERE g.status = 'started'
      AND NOT EXISTS (SELECT 1 FROM simul_players sp WHERE sp.game_id = g.id)
    ORDER BY (g.mode = 'live') DESC, g.created_at DESC
    LIMIT ?
  `).all(limit) as any[];

  return rows;
}

function parseImportedClock(headers: Map<string, string>): ClockConfig {
  const raw = (headers.get("TimeControl") ?? "").trim();
  if (!raw || raw === "?" || raw === "-") {
    return { mode: "live", initialMs: 300_000, incrementMs: 0 };
  }

  const correspondence = /^1\/(\d+)$/.exec(raw);
  if (correspondence) {
    return { mode: "correspondence", daysPerMove: Number(correspondence[1]) / 86_400 };
  }

  const live = /^([0-9]+)(?:\+([0-9]+))?$/.exec(raw);
  if (live) {
    return {
      mode: "live",
      initialMs: Number(live[1]) * 1000,
      incrementMs: Number(live[2] ?? 0) * 1000,
    };
  }

  return { mode: "live", initialMs: 300_000, incrementMs: 0 };
}

function resolveImportedUserId(username: string, importerId: number, importerName: string): number {
  const canonical = normalizeUsername(username);
  if (!canonical) throw new Error("Imported PGN is missing a player name");

  const me = normalizeUsername(importerName);
  if (canonical === me) return importerId;

  const existing = getDb().prepare(`SELECT id FROM users WHERE username = ?`).get(canonical) as { id: number } | undefined;
  if (existing) return existing.id;

  const info = getDb().prepare(`
    INSERT INTO users (username, password_hash, created_at, is_guest)
    VALUES (?, '!', ?, 1)
  `).run(canonical, Date.now());

  return Number(info.lastInsertRowid);
}

function importedVariant(headers: Map<string, string>): Variant {
  const variant = (headers.get("Variant") ?? "").trim().toLowerCase();
  if (variant === "chess960" || variant === "fischerandom" || variant === "fischer random") return "chess960";
  const fen = headers.get("FEN")?.trim();
  if (fen && fen !== "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1") {
    return "chess960";
  }
  return "standard";
}

function importedTermination(headers: Map<string, string>, lastSan: string | undefined, result: string | undefined): GameState["termination"] {
  const tag = (headers.get("Termination") ?? "").trim();
  const mapping: Record<string, GameState["termination"]> = {
    "Time forfeit": "timeout",
    "Abandoned": "abort",
    "Normal": "checkmate",
  };

  if (tag && mapping[tag]) return mapping[tag];
  if (lastSan?.endsWith("#")) return "checkmate";
  if (result === "1/2-1/2") return "agreement";
  if (result === "1-0" || result === "0-1") return "resignation";
  return "agreement";
}

function validateImportedPgn(pgnText: string): void {
  const cleaned = pgnText
    .replace(/\r/g, "")
    .replace(/^\s*\[[A-Za-z0-9][A-Za-z0-9_+#=:-]*\s+"(?:[^"\\]|\\"|\\\\)*"\]\s*/gm, "")
    .replace(/\{[^}]*\}/g, " ")
    .replace(/^\s*%.*$/gm, "")
    .trim();

  if (!cleaned) {
    throw new Error("No valid PGN games found in this file");
  }

  const noInternalComments = cleaned.replace(/\[[^\]]*\]/g, " ");
  if (/(?:[!?]){2,}/.test(noInternalComments)) {
    throw new Error("Illegal or unsupported PGN content");
  }
}

export function importPgnForUser(user: { id: number; username: string }, pgnText: string) {
  validateImportedPgn(pgnText);
  const parsed = parsePgn(pgnText);
  if (!parsed.length) {
    throw new Error("No valid PGN games found in this file");
  }

  const imported: string[] = [];

  for (const game of parsed) {
    const setup = startingPosition(game.headers);
    if (setup.isErr) {
      throw new Error(`Unsupported PGN variant or setup: ${game.headers.get("Variant") ?? "standard"}`);
    }

    const pos = setup.unwrap();
    const whiteName = game.headers.get("White")?.trim() ?? "White";
    const blackName = game.headers.get("Black")?.trim() ?? "Black";
    const whiteIsMe = normalizeUsername(whiteName) === normalizeUsername(user.username);
    const blackIsMe = normalizeUsername(blackName) === normalizeUsername(user.username);

    const whiteUserId = resolveImportedUserId(whiteName, user.id, user.username);
    const blackUserId = resolveImportedUserId(blackName, user.id, user.username);
    const meIsWhite = whiteIsMe || (!blackIsMe && !whiteIsMe);
    const whiteId = meIsWhite ? user.id : whiteUserId;
    const blackId = meIsWhite ? blackUserId : user.id;

    const state: GameState = {
      variant: importedVariant(game.headers),
      rated: false,
      initialFen: makeFen(pos.toSetup()),
      moves: [],
      ply: 0,
      turn: "white",
      clock: parseImportedClock(game.headers),
      whiteMs: 0,
      blackMs: 0,
      turnStartedAt: Date.now(),
      deadlineAt: Date.now(),
      status: "finished",
      result: undefined,
    };

    const rawResult = game.headers.get("Result") ?? "*";
    if (rawResult !== "*" && rawResult !== "1/2-1/2" && rawResult !== "1-0" && rawResult !== "0-1") {
      throw new Error("Unsupported PGN result format");
    }
    if (rawResult !== "*") state.result = rawResult as GameState["result"];

    const sanMoves: string[] = [];
    for (const node of game.moves.mainline()) {
      const move = parseSan(pos, node.san);
      if (!move) {
        throw new Error(`Illegal or unsupported move in PGN: ${node.san}`);
      }
      state.moves.push(makeUci(move));
      sanMoves.push(node.san);
      pos.play(move);
    }

    state.ply = state.moves.length;
    state.turn = state.ply % 2 === 0 ? "white" : "black";
    if (state.result === undefined && rawResult === "*") {
      state.status = "started";
    }
    if (state.result) {
      state.termination = importedTermination(game.headers, sanMoves.at(-1), state.result);
    }

    const gameId = randomBytes(5).toString("hex");
    if (whiteId !== user.id && blackId !== user.id) {
      throw new Error("PGN does not include the current user as a participant");
    }

    const db = getDb();
    db.transaction(() => {
      db.prepare(`
        INSERT INTO games (
          id, white_id, black_id, variant, rated, mode,
          initial_ms, increment_ms, days_per_move,
          status, result, termination,
          initial_fen, fen, last_move, ply, white_ms, black_ms,
          turn_started_at, deadline_at, draw_offered_by, created_at, ended_at
        ) VALUES (
          @id, @whiteId, @blackId, @variant, @rated, @mode,
          @initialMs, @incrementMs, @daysPerMove,
          @status, @result, @termination,
          @initialFen, @fen, @lastMove, @ply, @whiteMs, @blackMs,
          @turnStartedAt, @deadlineAt, @drawOfferedBy, @createdAt, @endedAt
        )`).run({
          id: gameId,
          whiteId,
          blackId,
          variant: state.variant,
          rated: state.rated ? 1 : 0,
          mode: state.clock.mode,
          initialMs: state.clock.mode === "live" ? state.clock.initialMs ?? 0 : null,
          incrementMs: state.clock.mode === "live" ? state.clock.incrementMs ?? 0 : null,
          daysPerMove: state.clock.mode === "correspondence" ? state.clock.daysPerMove ?? null : null,
          status: state.status,
          result: state.result ?? null,
          termination: state.termination ?? null,
          initialFen: state.initialFen,
          fen: state.initialFen,
          lastMove: state.moves.at(-1) ?? null,
          ply: state.ply,
          whiteMs: state.whiteMs,
          blackMs: state.blackMs,
          turnStartedAt: state.turnStartedAt,
          deadlineAt: state.deadlineAt,
          drawOfferedBy: null,
          createdAt: Date.now(),
          endedAt: state.status === "finished" ? Date.now() : null,
        });

      for (let i = 0; i < state.moves.length; i++) {
        db.prepare(`INSERT INTO moves (game_id, ply, uci, san) VALUES (?, ?, ?, ?)`)
          .run(gameId, i + 1, state.moves[i], sanMoves[i]);
      }
    }).immediate();

    imported.push(gameId);
  }

  return imported;
}

// Public preview for the invite page. Works for any live challenge; never exposes user ids.
export function getInvitePreview(id: string) {
  return getDb()
    .prepare(
      `SELECT c.id, u.username AS from_name, c.mode, c.initial_ms, c.increment_ms, c.days_per_move, c.rated,
              c.color_pref, (c.to_user IS NOT NULL) AS targeted
       FROM challenges c JOIN users u ON u.id = c.from_user
       WHERE c.id = ? AND c.expires_at > ?`,
    )
    .get(id, Date.now()) as
    | {
        id: string;
        from_name: string;
        mode: "live" | "correspondence";
        initial_ms: number | null;
        increment_ms: number | null;
        days_per_move: number | null;
        rated: number;
        color_pref: string | null;
        targeted: number;
      }
    | undefined;
}