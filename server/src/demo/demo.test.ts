import { fenAfterMoves } from "@lilchess/shared";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { config, loadConfig } from "../config.js";
import { closeDb, getDb, openDb } from "../db/connection.js";
import { getGame } from "../db/repositories/games.js";
import { registerUser } from "../testing/helpers.js";
import { chooseBotMove, ensureDemoBot, runDemoBotTick } from "./bot.js";
import { DEMO_MAX_ACTIVE_GAMES, purgeDemoData, startDemoGame } from "./data.js";

const HOUR = 60 * 60 * 1000;
const LATER = () => Date.now() + 60_000; // past the bot's "thinking" delay

describe("demo configuration", () => {
  it("is off by default and needs guests and open registration", () => {
    expect(loadConfig({}).demoMode).toBe(false);
    expect(loadConfig({ DEMO_MODE: "true" })).toMatchObject({ demoMode: true, demoRetentionHours: 24 });
    expect(() => loadConfig({ DEMO_MODE: "true", ALLOW_GUESTS: "false" })).toThrow(/ALLOW_GUESTS/);
    expect(() => loadConfig({ DEMO_MODE: "true", REGISTRATION: "closed" })).toThrow(/REGISTRATION/);
    expect(() => loadConfig({ DEMO_RETENTION_HOURS: "0" })).toThrow(/DEMO_RETENTION_HOURS/);
  });
});

describe("demo server", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    openDb(":memory:");
    app = await buildApp();
  });
  afterEach(async () => {
    config.demoMode = false;
    await app.close();
    closeDb();
  });

  const demoOn = () => {
    config.demoMode = true;
    return ensureDemoBot();
  };
  const begin = async () => {
    const botId = demoOn();
    const res = await app.inject({ method: "POST", url: "/api/native/demo" });
    const body = res.json() as { sessionToken: string; gameId: string; user: { id: number } };
    const auth = { authorization: `Bearer ${body.sessionToken}` };
    const row = getDb().prepare(`SELECT white_id FROM games WHERE id = ?`).get(body.gameId) as { white_id: number };
    return { botId, auth, gameId: body.gameId, guestId: body.user.id, botIsWhite: row.white_id === botId };
  };

  it("reports demo mode in the health response", async () => {
    expect((await app.inject({ method: "GET", url: "/api/health" })).json().features.demo).toBe(false);
    config.demoMode = true;
    expect((await app.inject({ method: "GET", url: "/api/health" })).json().features.demo).toBe(true);
  });

  it("does not exist unless DEMO_MODE is on", async () => {
    const res = await app.inject({ method: "POST", url: "/api/native/demo" });
    expect(res.statusCode).toBe(404);
  });

  it("starts a guest and a casual game against the bot without any credentials", async () => {
    const botId = demoOn();
    const res = await app.inject({ method: "POST", url: "/api/native/demo" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ ok: true, botName: "demo_bot", user: { is_guest: 1, is_admin: 0 } });
    expect(body.sessionToken).toMatch(/^[0-9a-f]{64}$/);
    expect(res.headers["set-cookie"]).toBeUndefined();

    const game = getGame(body.gameId)!;
    expect(game).toMatchObject({ variant: "standard", rated: false, status: "started", clock: { mode: "live", initialMs: 600_000 } });
    const row = getDb().prepare(`SELECT white_id, black_id FROM games WHERE id = ?`).get(body.gameId) as { white_id: number; black_id: number };
    expect([row.white_id, row.black_id].sort()).toEqual([botId, body.user.id].sort());

    const me = await app.inject({ method: "GET", url: "/api/me", headers: { authorization: `Bearer ${body.sessionToken}` } });
    expect(me.json().user.username).toBe(body.user.username);
  });

  it("gives every visitor their own guest and game", async () => {
    demoOn();
    const a = (await app.inject({ method: "POST", url: "/api/native/demo" })).json();
    const b = (await app.inject({ method: "POST", url: "/api/native/demo" })).json();
    expect(a.gameId).not.toBe(b.gameId);
    expect(a.user.id).not.toBe(b.user.id);
    expect(a.sessionToken).not.toBe(b.sessionToken);
  });

  it("keeps demo guests in their place: no challenges, no rated games", async () => {
    const { auth } = await begin();
    const challenge = await app.inject({
      method: "POST", url: "/api/challenges", headers: auth, payload: { mode: "live", initialMs: 300_000, incrementMs: 0 },
    });
    expect(challenge.statusCode).toBe(403);
  });

  it("stops at capacity", async () => {
    const botId = demoOn();
    const insertGameRow = getDb().prepare(`
      INSERT INTO games (id, white_id, black_id, variant, mode, initial_ms, increment_ms, status, initial_fen, ply, white_ms, black_ms,
                         turn_started_at, deadline_at, created_at, rated)
      VALUES (?, ?, ?, 'standard', 'live', 600000, 0, 'started', 'x', 0, 600000, 600000, 0, ?, 0, 0)`);
    getDb().exec(`INSERT INTO users (id, username, password_hash, created_at) VALUES (900,'solo','x',0)`);
    for (let i = 0; i < DEMO_MAX_ACTIVE_GAMES; i++) insertGameRow.run(`cap${i}`, botId, 900, Date.now() + HOUR);
    expect(startDemoGame()).toBeNull();
    expect((await app.inject({ method: "POST", url: "/api/native/demo" })).statusCode).toBe(503);
  });

  it("plays a game: the bot answers every move and the guest can finish it", async () => {
    const { auth, gameId, botIsWhite } = await begin();
    const botColor = botIsWhite ? "white" : "black";
    for (let i = 0; i < 6; i++) {
      runDemoBotTick(LATER());
      const state = getGame(gameId)!;
      expect(state.turn).not.toBe(botColor); // the bot has answered, so it is the guest's turn
      const fen = fenAfterMoves(state.initialFen, state.moves, state.variant)!;
      const res = await app.inject({
        method: "POST", url: `/api/games/${gameId}/move`, headers: auth, payload: { ply: state.ply, uci: chooseBotMove(fen, "standard")! },
      });
      expect(res.statusCode).toBe(200);
    }
    expect(getGame(gameId)!.ply).toBeGreaterThanOrEqual(11);

    const resign = await app.inject({ method: "POST", url: `/api/games/${gameId}/resign`, headers: auth });
    expect(resign.statusCode).toBe(200);
    expect(getGame(gameId)).toMatchObject({ status: "finished", termination: "resignation", result: botIsWhite ? "1-0" : "0-1" });
    expect(runDemoBotTick(LATER()).moves).toBe(0); // finished games are left alone
  });

  it("does not move before its thinking delay, and never moves twice for one turn", async () => {
    const { gameId, botIsWhite } = await begin();
    if (!botIsWhite) return; // the bot only has the first move when it drew white
    expect(runDemoBotTick(Date.now())).toEqual({ moves: 0, declined: 0 });
    expect(runDemoBotTick(LATER()).moves).toBe(1);
    expect(runDemoBotTick(LATER()).moves).toBe(0);
    expect(getGame(gameId)!.ply).toBe(1);
  });

  it("declines draw offers instead of leaving them hanging", async () => {
    const { auth, gameId, botIsWhite } = await begin();
    if (botIsWhite) runDemoBotTick(LATER());
    const state = getGame(gameId)!;
    const fen = fenAfterMoves(state.initialFen, state.moves, state.variant)!;
    await app.inject({ method: "POST", url: `/api/games/${gameId}/move`, headers: auth, payload: { ply: state.ply, uci: chooseBotMove(fen, "standard")! } });
    const offer = await app.inject({ method: "POST", url: `/api/games/${gameId}/draw/offer`, headers: auth });
    expect(offer.statusCode).toBe(200);
    expect(getGame(gameId)!.drawOfferedBy).toBeDefined();
    expect(runDemoBotTick(LATER()).declined).toBe(1);
    expect(getGame(gameId)!.drawOfferedBy).toBeUndefined();
  });

  it("finds a mate in one, and never chooses an illegal move", () => {
    expect(chooseBotMove("rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq g3 0 2", "standard")).toBe("d8h4");
    const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    for (let i = 0; i < 20; i++) expect(chooseBotMove(fen, "standard", Math.random)).toMatch(/^[a-h][1-8][a-h][1-8]$/);
    expect(chooseBotMove("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1", "standard")).toBeUndefined();
  });

  it("refuses to adopt a real account that already uses the bot's name", async () => {
    await registerUser(app, "demo_bot");
    expect(() => ensureDemoBot()).toThrow(/real account/);
  });
});

describe("purgeDemoData", () => {
  beforeEach(() => openDb(":memory:"));
  afterEach(() => closeDb());

  const NOW = 100 * HOUR;
  const insertGameRow = (id: string, white: number, black: number, createdAt: number) =>
    getDb().prepare(`
      INSERT INTO games (id, white_id, black_id, variant, mode, initial_ms, increment_ms, status, initial_fen, ply, white_ms, black_ms,
                         turn_started_at, deadline_at, created_at, rated)
      VALUES (?, ?, ?, 'standard', 'live', 600000, 0, 'started', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 1,
              600000, 600000, ?, ?, ?, 0)`).run(id, white, black, createdAt, createdAt + 1, createdAt);

  it("removes old bot games and their guests, and nothing else", () => {
    const db = getDb();
    const bot = ensureDemoBot();
    db.exec(`
      INSERT INTO users (id, username, password_hash, created_at, is_guest) VALUES
        (101,'alice','x',0,0), (102,'bob','x',0,0),
        (201,'guest_old000','!',${NOW - 30 * HOUR},1), (202,'guest_new000','!',${NOW - HOUR},1),
        (203,'guest_mixed0','!',${NOW - 30 * HOUR},1), (204,'guest_idle00','!',${NOW - 30 * HOUR},1);
      INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('s201',201,${NOW * 10}), ('s202',202,${NOW * 10}), ('s203',203,${NOW * 10}), ('s204',204,${NOW * 10});
      INSERT INTO challenges (id, from_user, mode, initial_ms, increment_ms, created_at, expires_at) VALUES ('c204',204,'live',60000,0,0,${NOW * 10});
    `);
    insertGameRow("g_old", bot, 201, NOW - 30 * HOUR);
    insertGameRow("g_new", bot, 202, NOW - HOUR);
    insertGameRow("g_mixed_bot", 203, bot, NOW - 30 * HOUR);
    insertGameRow("g_mixed_human", 101, 203, NOW - 30 * HOUR);
    insertGameRow("g_humans", 101, 102, NOW - 30 * HOUR);
    db.prepare(`INSERT INTO moves (game_id, ply, uci, san) VALUES ('g_old', 1, 'e2e4', 'e4'), ('g_humans', 1, 'e2e4', 'e4')`).run();

    expect(purgeDemoData(NOW, 24 * HOUR)).toEqual({ games: 2, guests: 2 });

    const ids = (sql: string) => (db.prepare(sql).all() as { id: string | number }[]).map((r) => r.id);
    expect(ids(`SELECT id FROM games ORDER BY id`)).toEqual(["g_humans", "g_mixed_human", "g_new"]);
    // guest_old and the idle guest are gone (with sessions and challenges); the others keep their accounts.
    expect(ids(`SELECT id FROM users WHERE is_guest = 1 ORDER BY id`)).toEqual([202, 203]);
    expect(ids(`SELECT user_id AS id FROM sessions ORDER BY user_id`)).toEqual([202, 203]);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM challenges`).get()).toEqual({ n: 0 });
    expect(db.prepare(`SELECT game_id FROM moves`).all()).toEqual([{ game_id: "g_humans" }]);
    // Registered users and the bot itself are untouched.
    expect(ids(`SELECT id FROM users WHERE is_guest = 0 ORDER BY id`)).toEqual([bot, 101, 102].sort((a, b) => a - b));
  });

  it("does nothing without a bot, and a second run finds nothing new", () => {
    expect(purgeDemoData(NOW, 0)).toEqual({ games: 0, guests: 0 });
    ensureDemoBot();
    expect(purgeDemoData(NOW, 0)).toEqual({ games: 0, guests: 0 });
  });
});
