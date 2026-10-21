import { fenAfterMoves, legalMoves, type Color } from "@lilchess/shared";
import { getDb } from "../db/connection.js";
import { declineDrawAndPersist, declineTakebackAndPersist, getGame, submitMove } from "../db/repositories/games.js";
import { logger } from "../logger.js";

const log = logger.child({ mod: "demo-bot" });

/** The demo opponent's account. It has no usable password, so nobody can sign in as it. */
export const DEMO_BOT_USERNAME = "demo_bot";

const TICK_MS = 500;
/** The bot waits this long after its turn starts, so replies do not feel instant. */
const THINK_MS = 700;
const MAX_GAMES_PER_TICK = 200;

let timer: NodeJS.Timeout | undefined;

export function demoBotId(): number | undefined {
  const row = getDb().prepare(`SELECT id FROM users WHERE username = ?`).get(DEMO_BOT_USERNAME) as { id: number } | undefined;
  return row?.id;
}

/** Creates the bot account if needed. Refuses to adopt a real account that already uses the name. */
export function ensureDemoBot(): number {
  const db = getDb();
  const row = db.prepare(`SELECT id, password_hash, is_guest FROM users WHERE username = ?`)
    .get(DEMO_BOT_USERNAME) as { id: number; password_hash: string; is_guest: number } | undefined;
  if (row) {
    if (row.password_hash !== "!" || row.is_guest !== 0) {
      throw new Error(`DEMO_MODE needs the username '${DEMO_BOT_USERNAME}' for its practice bot, but a real account already uses it.`);
    }
    return row.id;
  }
  const info = db.prepare(`
    INSERT INTO users (username, password_hash, created_at, is_admin, is_guest)
    VALUES (?, '!', ?, 0, 0)
  `).run(DEMO_BOT_USERNAME, Date.now());
  return Number(info.lastInsertRowid);
}

/** Checkmate if possible, otherwise captures about half the time, otherwise anything legal. */
export function chooseBotMove(fen: string, variant: Parameters<typeof legalMoves>[1], random: () => number = Math.random): string | undefined {
  const moves = legalMoves(fen, variant);
  if (moves.length === 0) return undefined;
  const mate = moves.find((m) => m.checkmate);
  if (mate) return mate.uci;
  const captures = moves.filter((m) => m.capture);
  const pool = captures.length > 0 && random() < 0.5 ? captures : moves;
  return pool[Math.floor(random() * pool.length)]?.uci;
}

/**
 * One pass over the bot's running games: decline draw and takeback offers, and move where it is the bot's turn.
 * It works from the database every time, so it picks games up again after a restart and needs no hooks into the
 * game code. A move that races a human action is rejected by the normal ply check.
 */
export function runDemoBotTick(now = Date.now()): { moves: number; declined: number } {
  const botId = demoBotId();
  const result = { moves: 0, declined: 0 };
  if (botId === undefined) return result;

  const games = getDb().prepare(`
    SELECT id, white_id FROM games
    WHERE status = 'started' AND (white_id = ? OR black_id = ?)
    ORDER BY created_at LIMIT ?
  `).all(botId, botId, MAX_GAMES_PER_TICK) as { id: string; white_id: number }[];

  for (const { id, white_id } of games) {
    try {
      const state = getGame(id);
      if (!state || state.status !== "started") continue;
      const color: Color = white_id === botId ? "white" : "black";

      if (state.drawOfferedBy && state.drawOfferedBy !== color && declineDrawAndPersist(id, botId).ok) result.declined++;
      if (state.takebackOfferedBy && state.takebackOfferedBy !== color && declineTakebackAndPersist(id, botId).ok) result.declined++;

      if (state.turn !== color || now - state.turnStartedAt < THINK_MS) continue;
      const fen = fenAfterMoves(state.initialFen, state.moves, state.variant);
      if (!fen) continue;
      const uci = chooseBotMove(fen, state.variant);
      if (uci && submitMove(id, botId, state.ply, uci).ok) result.moves++;
    } catch (err) {
      log.error({ err, gameId: id }, "demo bot could not play");
    }
  }
  return result;
}

export function startDemoBot(): void {
  ensureDemoBot();
  if (timer) return;
  timer = setInterval(() => {
    try {
      runDemoBotTick();
    } catch (err) {
      log.error({ err }, "demo bot tick failed");
    }
  }, TICK_MS);
  timer.unref();
}

export function stopDemoBot(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
}
