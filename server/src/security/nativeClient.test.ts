import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { closeDb, openDb } from "../db/connection.js";
import { registerUser, startGame } from "../testing/helpers.js";
import { opened, rejectedWith } from "../testing/wsHelpers.js";
import { originAllowed } from "./csrf.js";

// Mobile Phase 0 baseline (see docs/mobile-phase-0-review.md).
//
// These tests pin how the server treats clients that are NOT the same-origin web app:
// a Capacitor WebView (which sends its own Origin, e.g. capacitor://localhost) and native HTTP
// (which sends no Origin). They exist so that any later change to Origin/CSRF handling for the
// mobile client is a deliberate, reviewed change that updates a test, never an accident.
// If you are widening a check for mobile, scope it narrowly and change the test with it.

// Origins a Capacitor WebView can present. Which one applies depends on the app's
// server.iosScheme / server.androidScheme / server.hostname (pinned in mobile Phase 1).
const WEBVIEW_ORIGINS = ["capacitor://localhost", "https://localhost", "http://localhost"];
const challenge = { mode: "live", initialMs: 300_000, incrementMs: 0, colorPref: "white" };

describe("originAllowed: WebView origins", () => {
  it("rejects every Capacitor WebView origin when BASE_URL pins the server origin", () => {
    const base = "https://chess.example.com";
    for (const origin of WEBVIEW_ORIGINS) {
      expect(originAllowed(origin, "chess.example.com", base)).toBe(false);
    }
  });

  it("rejects them without BASE_URL too, because the host differs from the server's Host", () => {
    for (const origin of WEBVIEW_ORIGINS) {
      expect(originAllowed(origin, "chess.example.com", undefined)).toBe(false);
    }
  });

  it("still allows a request with no Origin header (native HTTP, curl)", () => {
    expect(originAllowed(undefined, "chess.example.com", "https://chess.example.com")).toBe(true);
  });
});

describe("HTTP: native clients vs CSRF and CORS", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    openDb(":memory:");
    app = await buildApp();
  });
  afterEach(async () => {
    await app.close();
    closeDb();
  });

  async function nativeToken(username: string): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/api/native/register",
      payload: { username, password: "hunter22!" },
    });
    expect(res.statusCode).toBe(200);
    return res.json().sessionToken as string;
  }

  it("accepts a bearer-authenticated state-changing request that carries no Origin", async () => {
    const token = await nativeToken("alice");
    const res = await app.inject({
      method: "POST",
      url: "/api/challenges",
      headers: { authorization: `Bearer ${token}` },
      payload: challenge,
    });
    expect(res.statusCode).toBe(200);
  });

  it("accepts the same request from the web app's own origin (control)", async () => {
    const token = await nativeToken("alice");
    const res = await app.inject({
      method: "POST",
      url: "/api/challenges",
      headers: {
        authorization: `Bearer ${token}`,
        host: "chess.example.com",
        origin: "https://chess.example.com",
      },
      payload: challenge,
    });
    expect(res.statusCode).toBe(200);
  });

  it.each(WEBVIEW_ORIGINS)("blocks a state-changing request from WebView origin %s, even with a valid bearer token", async (origin) => {
    const token = await nativeToken("alice");
    const res = await app.inject({
      method: "POST",
      url: "/api/challenges",
      headers: { authorization: `Bearer ${token}`, host: "chess.example.com", origin },
      payload: challenge,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("Cross-origin request blocked");
  });

  it("blocks native login from a WebView origin, so WebView fetch() cannot be the mobile transport", async () => {
    await nativeToken("alice");
    const res = await app.inject({
      method: "POST",
      url: "/api/native/login",
      headers: { host: "chess.example.com", origin: "capacitor://localhost" },
      payload: { username: "alice", password: "hunter22!" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("blocks Sec-Fetch-Site: cross-site even with a valid bearer token", async () => {
    const token = await nativeToken("alice");
    const res = await app.inject({
      method: "POST",
      url: "/api/challenges",
      headers: { authorization: `Bearer ${token}`, "sec-fetch-site": "cross-site" },
      payload: challenge,
    });
    expect(res.statusCode).toBe(403);
  });

  it("sends no CORS headers, so a WebView cannot read API responses cross-origin", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { origin: "capacitor://localhost" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("never sets a cookie for a native bearer request that fails authentication", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { authorization: `Bearer ${"0".repeat(64)}` },
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });
});

describe("WebSocket upgrade: native clients", () => {
  let app: FastifyInstance;
  let port: number;
  let gameId: string;
  let token: string;
  const sockets: WebSocket[] = [];

  beforeEach(async () => {
    openDb(":memory:");
    app = await buildApp();
    await app.listen({ port: 0, host: "127.0.0.1" });
    port = (app.server.address() as AddressInfo).port;

    const alice = await registerUser(app, "alice");
    const bob = await registerUser(app, "bob");
    gameId = await startGame(app, alice, bob);
    const login = await app.inject({
      method: "POST",
      url: "/api/native/login",
      payload: { username: "alice", password: "hunter22!" },
    });
    token = login.json().sessionToken as string;
  });

  afterEach(async () => {
    for (const s of sockets.splice(0)) s.terminate();
    await app.close();
    closeDb();
  });

  function connect(opts: { bearer?: boolean; origin?: string; query?: string; protocols?: string[] }): WebSocket {
    const url = `ws://127.0.0.1:${port}/ws/games/${gameId}${opts.query ?? ""}`;
    const options = {
      headers: opts.bearer ? { Authorization: `Bearer ${token}` } : {},
      origin: opts.origin,
      perMessageDeflate: false,
    };
    const ws = opts.protocols
      ? new WebSocket(url, opts.protocols, options)
      : new WebSocket(url, options);
    ws.on("error", () => {}); // a rejected upgrade surfaces as an error too
    sockets.push(ws);
    return ws;
  }

  it("accepts a bearer upgrade from the web app's own origin (control)", async () => {
    const ws = connect({ bearer: true, origin: `http://127.0.0.1:${port}` });
    await opened(ws);
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });

  it.each(WEBVIEW_ORIGINS)("rejects an upgrade from WebView origin %s with 403, even with a valid bearer token", async (origin) => {
    expect(await rejectedWith(connect({ bearer: true, origin }))).toBe(403);
  });

  it("does not accept a bearer token passed in the URL query string", async () => {
    expect(await rejectedWith(connect({ query: `?token=${token}` }))).toBe(401);
    expect(await rejectedWith(connect({ query: `?access_token=${token}` }))).toBe(401);
  });

  it("creates a native guest bearer session only for a valid eligible invite", async () => {
    const challengeResponse = await app.inject({
      method: "POST",
      url: "/api/challenges",
      headers: { authorization: `Bearer ${token}` },
      payload: challenge,
    });
    expect(challengeResponse.statusCode).toBe(200);

    const guestResponse = await app.inject({
      method: "POST",
      url: "/api/native/guest",
      payload: { challengeId: challengeResponse.json().challengeId },
    });
    expect(guestResponse.statusCode).toBe(200);
    expect(guestResponse.headers["set-cookie"]).toBeUndefined();
    expect(guestResponse.json().sessionToken).toMatch(/^[a-f\d]{64}$/i);

    const me = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { authorization: `Bearer ${guestResponse.json().sessionToken}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.is_guest).toBe(1);
  });

  it("authenticates a Capacitor-origin WebSocket with a one-use ticket and never echoes it", async () => {
    const issued = await app.inject({
      method: "POST",
      url: "/api/native/ws-ticket",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(issued.statusCode).toBe(200);
    const ticket = issued.json().ticket as string;
    expect(ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(issued.json().expiresInMs).toBe(30_000);

    const protocols = ["lilchess.v1", `lilchess-ticket.${ticket}`];
    expect(await rejectedWith(connect({ origin: "https://untrusted.example", protocols }))).toBe(403);

    const ws = connect({ origin: "capacitor://localhost", protocols });
    await opened(ws);
    expect(ws.protocol).toBe("lilchess.v1");
    expect(ws.protocol).not.toContain(ticket);

    expect(await rejectedWith(connect({ origin: "capacitor://localhost", protocols }))).toBe(403);
  });

  it("requires a bearer session to issue a WebSocket ticket and does not clear cookies for native logout", async () => {
    const unauthorized = await app.inject({ method: "POST", url: "/api/native/ws-ticket" });
    expect(unauthorized.statusCode).toBe(401);

    const logout = await app.inject({
      method: "POST",
      url: "/api/logout",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(logout.statusCode).toBe(200);
    expect(logout.headers["set-cookie"]).toBeUndefined();
  });
});
