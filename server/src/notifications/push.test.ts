import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGame, NOTIFICATION_KINDS, type ClockConfig, type GameState } from "@lilchess/shared";

const wp = vi.hoisted(() => ({
  generateVAPIDKeys: vi.fn(() => ({ publicKey: "test-public-key", privateKey: "test-private-key" })),
  sendNotification: vi.fn(),
}));
vi.mock("web-push", () => ({ default: wp }));

import { buildApp } from "../app.js";
import { config, loadConfig } from "../config.js";
import { closeDb, getDb, openDb } from "../db/connection.js";
import { insertGame } from "../db/repositories/games.js";
import { registerUser } from "../testing/helpers.js";
import { notifyChallengeReceived, notifyYourTurn } from "./dispatch.js";
import { isPushEndpoint, vapidKeys } from "./push.js";
import { getPrefs, listSubscriptions, saveSubscription, setPrefs } from "./queries.js";

const CORR: ClockConfig = { mode: "correspondence", daysPerMove: 3 };
const FCM = "https://fcm.googleapis.com/fcm/send/abc";
const MOZ = "https://updates.push.services.mozilla.com/wpush/v2/xyz";
const sub = (endpoint = FCM) => ({ endpoint, p256dh: "p", auth: "a" });
const afterWhite = (): GameState => ({ ...createGame({ clock: CORR, now: 0 }), moves: ["e2e4"], ply: 1, turn: "black" });
const payloads = () => wp.sendNotification.mock.calls.map(([, body]) => JSON.parse(body as string));

beforeEach(() => {
  wp.sendNotification.mockReset().mockResolvedValue({ statusCode: 201 });
  wp.generateVAPIDKeys.mockClear();
  config.baseOrigin = "https://chess.test";
});
afterEach(() => {
  config.baseOrigin = undefined;
  config.pushEnabled = true;
  config.pushSubject = undefined;
  config.pushExtraHosts = [];
  config.nodeEnv = "test";
});

describe("push endpoint allow-list", () => {
  it("accepts the major push services and their subdomains", () => {
    for (const url of [FCM, MOZ, "https://web.push.apple.com/QAbc", "https://wns2-par02p.notify.windows.com/w/?token=x"]) {
      expect(isPushEndpoint(url), url).toBe(true);
    }
  });

  it("rejects http, other hosts, IPs, credentials, odd ports and lookalikes", () => {
    for (const url of [
      "http://fcm.googleapis.com/x",
      "https://internal.example.com/hook",
      "https://169.254.169.254/latest",
      "https://user:pw@fcm.googleapis.com/x",
      "https://fcm.googleapis.com:8443/x",
      "https://evilfcm.googleapis.com.example.com/x",
      "https://notfcm.googleapis.com.evil.test/x",
      "not a url",
    ]) {
      expect(isPushEndpoint(url), url).toBe(false);
    }
  });

  it("can be extended by the operator", () => {
    expect(isPushEndpoint("https://push.example.org/x")).toBe(false);
    config.pushExtraHosts = ["push.example.org"];
    expect(isPushEndpoint("https://push.example.org/x")).toBe(true);
    expect(isPushEndpoint("https://a.push.example.org/x")).toBe(true);
  });
});

describe("push configuration", () => {
  it("defaults on, and parses the optional settings", () => {
    expect(loadConfig({}).pushEnabled).toBe(true);
    const c = loadConfig({ PUSH_ENABLED: "false", PUSH_SUBJECT: "mailto:me@example.com", PUSH_ENDPOINT_HOSTS: " Push.Example.org , ,b.test" });
    expect(c).toMatchObject({ pushEnabled: false, pushSubject: "mailto:me@example.com", pushExtraHosts: ["push.example.org", "b.test"] });
  });

  it("rejects a malformed PUSH_SUBJECT", () => {
    expect(() => loadConfig({ PUSH_SUBJECT: "http://example.com" })).toThrow(/PUSH_SUBJECT/);
    expect(() => loadConfig({ PUSH_SUBJECT: "nobody" })).toThrow(/PUSH_SUBJECT/);
  });
});

describe("push API", () => {
  let app: FastifyInstance;
  let alice: string;
  let bob: string;

  const call = (method: "GET" | "POST" | "PUT" | "DELETE", url: string, sid?: string, payload?: object) =>
    app.inject({ method, url, cookies: sid ? { sessionId: sid } : {}, payload });
  const subscribe = (sid: string | undefined, endpoint = FCM) =>
    call("POST", "/api/me/push-subscription", sid, { endpoint, keys: { p256dh: "p", auth: "a" } });

  beforeEach(async () => {
    openDb(":memory:");
    app = await buildApp();
    alice = await registerUser(app, "alice");
    bob = await registerUser(app, "bob");
  });
  afterEach(async () => {
    await app.close();
    closeDb();
  });

  it("reports availability, the public key and no devices to start with", async () => {
    const body = (await call("GET", "/api/me/notifications", alice)).json();
    expect(body).toMatchObject({ pushAvailable: true, pushPublicKey: "test-public-key", pushDevices: 0 });
    expect(Object.values(body.pushPrefs)).toEqual(NOTIFICATION_KINDS.map(() => true));
  });

  it("stores a device, counts it, and removes it again", async () => {
    expect((await subscribe(alice)).json().pushDevices).toBe(1);
    expect(listSubscriptions(1)).toEqual([sub()]);
    const res = await call("DELETE", "/api/me/push-subscription", alice, { endpoint: FCM });
    expect(res.json().pushDevices).toBe(0);
  });

  it("registering the same endpoint twice keeps one row", async () => {
    await subscribe(alice);
    expect((await subscribe(alice)).json().pushDevices).toBe(1);
  });

  it("moves a device to whoever registers it last, and only the owner can remove it", async () => {
    await subscribe(alice);
    await subscribe(bob);
    expect(listSubscriptions(1)).toEqual([]);
    expect(listSubscriptions(2)).toEqual([sub()]);

    await call("DELETE", "/api/me/push-subscription", alice, { endpoint: FCM });
    expect(listSubscriptions(2)).toHaveLength(1);
  });

  it("rejects unsupported endpoints and malformed bodies", async () => {
    expect((await subscribe(alice, "https://internal.example.com/hook")).statusCode).toBe(400);
    expect((await subscribe(alice, "http://fcm.googleapis.com/x")).statusCode).toBe(400);
    expect((await call("POST", "/api/me/push-subscription", alice, { endpoint: FCM })).statusCode).toBe(400);
    expect(listSubscriptions(1)).toEqual([]);
  });

  it("requires a session and refuses guests", async () => {
    expect((await subscribe(undefined)).statusCode).toBe(401);

    const link = await call("POST", "/api/challenges", alice, { mode: "live", initialMs: 300_000, incrementMs: 0, link: true });
    const guest = await call("POST", "/api/guest", undefined, { challengeId: link.json().challengeId });
    const sid = guest.cookies.find((c) => c.name === "sessionId")!.value;
    expect((await subscribe(sid)).statusCode).toBe(403);
  });

  it("keeps at most ten devices per account, dropping the oldest", async () => {
    for (let i = 0; i < 12; i++) await subscribe(alice, `https://fcm.googleapis.com/fcm/send/${i}`);
    const endpoints = listSubscriptions(1).map((s) => s.endpoint);
    expect(endpoints).toHaveLength(10);
    expect(endpoints).not.toContain("https://fcm.googleapis.com/fcm/send/0");
    expect(endpoints).toContain("https://fcm.googleapis.com/fcm/send/11");
  });

  it("stores per-kind choices for the push channel only", async () => {
    const body = (await call("PUT", "/api/me/notifications", alice, { pushPrefs: { your_turn: false } })).json();
    expect(body.pushPrefs).toMatchObject({ your_turn: false, challenge_received: true });
    expect(body.prefs.your_turn).toBe(true);
    expect(body.discordPrefs.your_turn).toBe(true);
  });

  it("is switched off by PUSH_ENABLED=false, and in production without a contact URL", async () => {
    config.pushEnabled = false;
    expect((await call("GET", "/api/me/notifications", alice)).json()).toMatchObject({ pushAvailable: false, pushPublicKey: null });
    expect((await subscribe(alice)).statusCode).toBe(503);

    config.pushEnabled = true;
    config.baseOrigin = undefined;
    config.nodeEnv = "production";
    expect((await call("GET", "/api/me/notifications", alice)).json().pushAvailable).toBe(false);
    config.pushSubject = "mailto:admin@example.com";
    expect((await call("GET", "/api/me/notifications", alice)).json().pushAvailable).toBe(true);
  });

  it("lets people remove a device even when push is off", async () => {
    await subscribe(alice);
    config.pushEnabled = false;
    await call("DELETE", "/api/me/push-subscription", alice, { endpoint: FCM });
    expect(listSubscriptions(1)).toEqual([]);
  });

  it("sends a test notification to every device and reports how many accepted", async () => {
    expect((await call("POST", "/api/me/push-test", alice)).statusCode).toBe(409);
    await subscribe(alice, FCM);
    await subscribe(alice, MOZ);
    wp.sendNotification.mockRejectedValueOnce(Object.assign(new Error("boom"), { statusCode: 500 }));
    const res = (await call("POST", "/api/me/push-test", alice)).json();
    expect(res).toEqual({ ok: true, sent: 1, devices: 2 });
    expect(payloads()[0]).toMatchObject({ title: "LilChess test notification", path: "/settings" });
  });
});

describe("VAPID keys", () => {
  beforeEach(() => openDb(":memory:"));
  afterEach(() => closeDb());

  it("are generated once and then reused", () => {
    const a = vapidKeys();
    const b = vapidKeys();
    expect(a).toEqual({ publicKey: "test-public-key", privateKey: "test-private-key" });
    expect(b).toEqual(a);
    expect(wp.generateVAPIDKeys).toHaveBeenCalledTimes(1);
  });
});

describe("push delivery", () => {
  beforeEach(() => {
    openDb(":memory:");
    getDb().exec(`
      INSERT INTO users (id, username, password_hash, created_at) VALUES (1,'alice','x',0),(2,'bob','x',0);
    `);
    insertGame("g1", 1, 2, createGame({ clock: CORR, now: Date.now() }));
  });
  afterEach(() => closeDb());

  it("tells every device of the player to move, opening the game on click", async () => {
    saveSubscription(2, sub(FCM));
    saveSubscription(2, sub(MOZ));
    notifyYourTurn("g1", afterWhite(), "e2e4", "e4");
    await vi.waitFor(() => expect(wp.sendNotification).toHaveBeenCalledTimes(2));

    expect(wp.sendNotification.mock.calls.map(([s]) => s.endpoint).sort()).toEqual([FCM, MOZ].sort());
    expect(payloads()[0]).toEqual({
      title: "Your turn against Alice",
      body: "Alice played e4. It's your move.",
      path: "/game/g1",
      tag: "/game/g1",
    });
    const [, , options] = wp.sendNotification.mock.calls[0]!;
    expect(options).toMatchObject({ TTL: 86_400, vapidDetails: { publicKey: "test-public-key", privateKey: "test-private-key" } });
  });

  it("stays quiet without a device, for the wrong player, or when the kind is switched off", async () => {
    notifyYourTurn("g1", afterWhite(), "e2e4", "e4");
    saveSubscription(1, sub()); // alice just moved; it isn't her turn
    notifyYourTurn("g1", afterWhite(), "e2e4", "e4");

    saveSubscription(2, sub(MOZ));
    setPrefs(2, { your_turn: false }, "push");
    notifyYourTurn("g1", { ...afterWhite(), ply: 3 }, "d2d4", "d4");

    await new Promise((r) => setTimeout(r, 20));
    expect(wp.sendNotification).not.toHaveBeenCalled();
  });

  it("does not send the same notification twice", async () => {
    saveSubscription(2, sub());
    notifyYourTurn("g1", afterWhite(), "e2e4", "e4");
    notifyYourTurn("g1", afterWhite(), "e2e4", "e4");
    await vi.waitFor(() => expect(wp.sendNotification).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(wp.sendNotification).toHaveBeenCalledTimes(1);
  });

  it("respects disabling push for the server", async () => {
    saveSubscription(2, sub());
    config.pushEnabled = false;
    notifyYourTurn("g1", afterWhite(), "e2e4", "e4");
    await new Promise((r) => setTimeout(r, 20));
    expect(wp.sendNotification).not.toHaveBeenCalled();
  });

  it("forgets a device the push service says is gone, but keeps it after other errors", async () => {
    saveSubscription(2, sub(FCM));
    saveSubscription(2, sub(MOZ));
    wp.sendNotification.mockImplementation(async (s: { endpoint: string }) => {
      if (s.endpoint === FCM) throw Object.assign(new Error("gone"), { statusCode: 410 });
      throw Object.assign(new Error("down"), { statusCode: 503 });
    });
    notifyYourTurn("g1", afterWhite(), "e2e4", "e4");
    await vi.waitFor(() => expect(listSubscriptions(2).map((s) => s.endpoint)).toEqual([MOZ]));
  });

  it("a push failure does not stop other kinds from being delivered", async () => {
    saveSubscription(2, sub());
    wp.sendNotification.mockRejectedValue(new Error("network"));
    notifyChallengeReceived({ challengeId: "c1", fromName: "alice", toId: 2, clock: CORR });
    await vi.waitFor(() => expect(wp.sendNotification).toHaveBeenCalledTimes(1));
    expect(payloads()[0]).toMatchObject({ title: expect.stringContaining("challenged you"), path: "/", tag: "challenge:c1" });
  });

  it("push prefs default on and are independent of email and Discord", () => {
    setPrefs(2, { your_turn: false }, "push");
    expect(getPrefs(2, "push").your_turn).toBe(false);
    expect(getPrefs(2, "email").your_turn).toBe(true);
    expect(getPrefs(2, "discord").your_turn).toBe(true);
  });

  it("never sends to guests or disabled accounts", async () => {
    saveSubscription(2, sub());
    getDb().prepare(`UPDATE users SET disabled_at = ? WHERE id = 2`).run(Date.now());
    notifyYourTurn("g1", afterWhite(), "e2e4", "e4");
    await new Promise((r) => setTimeout(r, 20));
    expect(wp.sendNotification).not.toHaveBeenCalled();
  });

  it("deleting a user removes their devices", () => {
    saveSubscription(2, sub());
    getDb().prepare(`DELETE FROM games`).run();
    getDb().prepare(`DELETE FROM users WHERE id = 2`).run();
    expect(getDb().prepare(`SELECT COUNT(*) AS n FROM push_subscriptions`).get()).toEqual({ n: 0 });
  });
});
