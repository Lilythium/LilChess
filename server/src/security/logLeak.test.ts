import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import pino from "pino";
import WebSocket from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { closeDb, openDb } from "../db/connection.js";
import { logger } from "../logger.js";
import { opened } from "../testing/wsHelpers.js";

// Mobile Phase 9: credential leakage. Runs the whole native flow with the real application logger at
// trace level and asserts that no credential value ever reaches a log line.
//
// The logger is silent under Vitest, so this test raises its level and redirects its output stream
// before the app (and its per-request child loggers) are created.

describe("log output during a native session", () => {
  const lines: string[] = [];
  const streamSym = pino.symbols.streamSym as unknown as keyof typeof logger;
  const original = (logger as unknown as Record<symbol | string, unknown>)[streamSym];
  const originalLevel = logger.level;

  let app: FastifyInstance;
  let port: number;
  const sockets: WebSocket[] = [];

  beforeEach(async () => {
    lines.length = 0;
    (logger as unknown as Record<symbol | string, unknown>)[streamSym] = {
      write: (chunk: string) => void lines.push(chunk),
    };
    logger.level = "trace";
    openDb(":memory:");
    app = await buildApp();
    await app.listen({ port: 0, host: "127.0.0.1" });
    port = (app.server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    for (const s of sockets.splice(0)) s.terminate();
    await app.close();
    closeDb();
    (logger as unknown as Record<symbol | string, unknown>)[streamSym] = original;
    logger.level = originalLevel;
  });

  it("never records passwords, bearer tokens, WebSocket tickets or Authorization headers", async () => {
    const password = "hunter22!-leak-canary";
    const registered = await app.inject({
      method: "POST",
      url: "/api/native/register",
      payload: { username: "alice", password },
    });
    const token = registered.json().sessionToken as string;

    await app.inject({ method: "POST", url: "/api/native/register", payload: { username: "bob", password } });
    await app.inject({ method: "POST", url: "/api/native/login", payload: { username: "alice", password } });
    await app.inject({ method: "POST", url: "/api/native/login", payload: { username: "alice", password: "wrong-canary-pw" } });
    await app.inject({ method: "GET", url: "/api/me", headers: { authorization: `Bearer ${token}` } });
    await app.inject({ method: "GET", url: "/api/me", headers: { authorization: `Bearer ${"f".repeat(64)}` } });

    const issued = await app.inject({
      method: "POST",
      url: "/api/native/ws-ticket",
      headers: { authorization: `Bearer ${token}` },
    });
    const ticket = issued.json().ticket as string;

    const challenge = await app.inject({
      method: "POST",
      url: "/api/challenges",
      headers: { authorization: `Bearer ${token}` },
      payload: { mode: "live", initialMs: 300_000, incrementMs: 0, colorPref: "white" },
    });
    const gameId = challenge.json().challengeId as string;

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/games/${gameId}`, ["lilchess.v1", `lilchess-ticket.${ticket}`], {
      origin: "capacitor://localhost",
      perMessageDeflate: false,
    });
    ws.on("error", () => {});
    sockets.push(ws);
    await opened(ws).catch(() => {}); // the connection result is irrelevant here; only the logs matter

    await app.inject({ method: "POST", url: "/api/logout", headers: { authorization: `Bearer ${token}` } });

    const output = lines.join("\n");
    expect(output.length).toBeGreaterThan(0); // proves the capture works, so the checks below mean something
    for (const secret of [password, "wrong-canary-pw", token, ticket, "f".repeat(64)]) {
      expect(output).not.toContain(secret);
    }
    expect(output.toLowerCase()).not.toContain("authorization");
    expect(output.toLowerCase()).not.toContain("bearer ");
    expect(output).not.toContain("lilchess-ticket");
  });
});
