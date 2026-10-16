import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGame, type ClockConfig, type GameState } from "@lilchess/shared";

vi.mock("./mailer.js", () => ({
  emailEnabled: () => true,
  sendMail: vi.fn().mockResolvedValue(true),
}));

import { buildApp } from "../app.js";
import { config, loadConfig } from "../config.js";
import { closeDb, getDb, openDb } from "../db/connection.js";
import { insertGame } from "../db/repositories/games.js";
import { registerUser } from "../testing/helpers.js";
import { notifyChallengeReceived, notifyYourTurn } from "./dispatch.js";
import { sendMail } from "./mailer.js";
import { getPrefs, setPrefs } from "./queries.js";

const CORR: ClockConfig = { mode: "correspondence", daysPerMove: 3 };
const HOOK = "https://discord.com/api/webhooks/123/abc";
const BOB_DISCORD = "123456789012345678";

const fetchMock = vi.fn();
const afterWhite = (): GameState => ({ ...createGame({ clock: CORR, now: 0 }), moves: ["e2e4"], ply: 1, turn: "black" });
const posted = () => fetchMock.mock.calls.map(([, init]) => JSON.parse((init as { body: string }).body));

beforeEach(() => {
  config.baseOrigin = "https://chess.test";
  config.discordWebhookUrl = HOOK;
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset().mockResolvedValue({ ok: true, status: 204 });
  vi.mocked(sendMail).mockClear();
  openDb(":memory:");
  getDb().exec(`
    INSERT INTO users (id, username, password_hash, created_at, email, discord_id) VALUES
      (1,'alice','x',0,NULL,NULL),
      (2,'bob','x',0,'bob@example.com','${BOB_DISCORD}'),
      (3,'carol','x',0,NULL,NULL);
  `);
  insertGame("g1", 1, 2, createGame({ clock: CORR, now: Date.now() }));
});
afterEach(() => {
  closeDb();
  config.baseOrigin = undefined;
  config.discordWebhookUrl = undefined;
  vi.unstubAllGlobals();
});

describe("Discord notifications", () => {
  it("pings the player on move, mentioning only them", () => {
    notifyYourTurn("g1", afterWhite(), "e2e4", "e4");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe(HOOK);
    const [msg] = posted();
    expect(msg.content).toContain(`<@${BOB_DISCORD}>`);
    expect(msg.content).toContain("https://chess.test/#/game/g1");
    expect(msg.allowed_mentions).toEqual({ users: [BOB_DISCORD] });
  });

  it("sends nothing to a user who never gave a Discord ID", () => {
    notifyChallengeReceived({ challengeId: "c1", fromName: "bob", toId: 3, clock: CORR });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends nothing when the server has no webhook", () => {
    config.discordWebhookUrl = undefined;
    notifyYourTurn("g1", afterWhite(), "e2e4", "e4");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("honours the per-kind Discord toggles independently of the email ones", () => {
    setPrefs(2, { your_turn: false }, "discord");
    notifyYourTurn("g1", afterWhite(), "e2e4", "e4");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendMail).toHaveBeenCalledTimes(1); // email still on

    setPrefs(2, { your_turn: true }, "discord");
    setPrefs(2, { your_turn: false }, "email");
    vi.mocked(sendMail).mockClear();
    notifyYourTurn("g1", afterWhite(), "e2e5", "e5");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("sends each event once, and email and Discord don't suppress each other", () => {
    notifyYourTurn("g1", afterWhite(), "e2e4", "e4");
    notifyYourTurn("g1", afterWhite(), "e2e4", "e4");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it("never throws or blocks the caller when Discord fails", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    expect(() => notifyYourTurn("g1", afterWhite(), "e2e4", "e4")).not.toThrow();
    await Promise.resolve();
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it("truncates very long messages to fit Discord's limit", () => {
    notifyChallengeReceived({ challengeId: "c2", fromName: "x".repeat(5000), toId: 2, clock: CORR });
    expect(posted()[0].content.length).toBeLessThanOrEqual(1900);
  });

  it("skips disabled accounts and guests", () => {
    getDb().prepare(`UPDATE users SET disabled_at = 1 WHERE id = 2`).run();
    notifyYourTurn("g1", afterWhite(), "e2e4", "e4");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Discord settings API", () => {
  let app: FastifyInstance;
  let sid: string;
  const put = (payload: object) =>
    app.inject({ method: "PUT", url: "/api/me/notifications", cookies: { sessionId: sid }, payload });

  beforeEach(async () => {
    closeDb();
    openDb(":memory:");
    app = await buildApp();
    sid = await registerUser(app, "dana");
  });
  afterEach(async () => {
    await app.close();
  });

  it("starts opted out and reports whether the server can send", async () => {
    const res = (await app.inject({ method: "GET", url: "/api/me/notifications", cookies: { sessionId: sid } })).json();
    expect(res).toMatchObject({ discordId: null, discordAvailable: true });
    expect(res.discordPrefs.your_turn).toBe(true);
  });

  it("saves a Discord ID, then removes it", async () => {
    expect((await put({ discordId: "  234567890123456789 " })).json().discordId).toBe("234567890123456789");
    expect((await put({ discordId: "" })).json().discordId).toBeNull();
  });

  it("rejects things that aren't a user ID", async () => {
    expect((await put({ discordId: "dana#1234" })).statusCode).toBe(400);
    expect((await put({ discordId: "123" })).statusCode).toBe(400);
  });

  it("stores Discord toggles separately from email toggles", async () => {
    const res = (await put({ discordPrefs: { your_turn: false } })).json();
    expect(res.discordPrefs.your_turn).toBe(false);
    expect(res.prefs.your_turn).toBe(true);
    const id = (getDb().prepare(`SELECT id FROM users WHERE username = 'dana'`).get() as { id: number }).id;
    expect(getPrefs(id, "email").your_turn).toBe(true);
  });
});

describe("DISCORD_WEBHOOK_URL config", () => {
  it("accepts a discord.com webhook with BASE_URL, and rejects anything else", () => {
    const base = { BASE_URL: "https://chess.test" };
    expect(loadConfig({ ...base, DISCORD_WEBHOOK_URL: HOOK }).discordWebhookUrl).toBe(HOOK);
    expect(loadConfig({}).discordWebhookUrl).toBeUndefined();
    expect(() => loadConfig({ ...base, DISCORD_WEBHOOK_URL: "https://evil.example/api/webhooks/1/x" })).toThrow(/DISCORD_WEBHOOK_URL/);
    expect(() => loadConfig({ ...base, DISCORD_WEBHOOK_URL: "http://discord.com/api/webhooks/1/x" })).toThrow(/DISCORD_WEBHOOK_URL/);
    expect(() => loadConfig({ DISCORD_WEBHOOK_URL: HOOK })).toThrow(/BASE_URL/);
  });
});
