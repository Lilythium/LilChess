import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../notifications/mailer.js", () => ({
  emailEnabled: () => true,
  sendMail: vi.fn().mockResolvedValue(true),
}));

import { buildApp } from "../app.js";
import { closeDb, getDb, openDb } from "../db/connection.js";
import { sendMail } from "../notifications/mailer.js";
import { registerUser } from "../testing/helpers.js";

const sent = vi.mocked(sendMail);
const lastToken = () => /\/reset\/([0-9a-f]{64})/.exec(sent.mock.calls.at(-1)![0].text)![1]!;

describe("password reset", () => {
  let app: FastifyInstance;
  let alice: string;

  const forgot = (identifier: string) =>
    app.inject({ method: "POST", url: "/api/password/forgot", payload: { identifier } });
  const reset = (token: string, password: string) =>
    app.inject({ method: "POST", url: "/api/password/reset", payload: { token, password } });
  const login = (password: string) =>
    app.inject({ method: "POST", url: "/api/login", payload: { username: "alice", password } });

  beforeEach(async () => {
    openDb(":memory:");
    app = await buildApp();
    alice = await registerUser(app, "alice");
    await app.inject({
      method: "PUT", url: "/api/me/notifications", cookies: { sessionId: alice }, payload: { email: "Alice@Example.com" },
    });
    sent.mockClear();
  });
  afterEach(async () => {
    await app.close();
    closeDb();
  });

  it("emails a link for a username, and answers identically for unknown accounts", async () => {
    expect((await forgot("alice")).statusCode).toBe(200);
    expect(sent).toHaveBeenCalledTimes(1);
    expect(sent.mock.calls[0]![0].to).toBe("alice@example.com");

    expect((await forgot("nobody")).statusCode).toBe(200);
    expect((await forgot("nobody@example.com")).statusCode).toBe(200);
    expect(sent).toHaveBeenCalledTimes(1);
  });

  it("also finds the account by email, and sends only one link per cooldown", async () => {
    await forgot("ALICE@example.com");
    await forgot("alice");
    expect(sent).toHaveBeenCalledTimes(1);
  });

  it("sets the new password, ends other sessions, and works once", async () => {
    await forgot("alice");
    const token = lastToken();

    expect((await reset(token, "brand-new-pass")).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/me", cookies: { sessionId: alice } })).statusCode).toBe(401);
    expect((await login("hunter22!")).statusCode).toBe(401);
    expect((await login("brand-new-pass")).statusCode).toBe(200);
    expect((await reset(token, "another-pass1")).statusCode).toBe(400);
  });

  it("rejects expired and malformed links", async () => {
    await forgot("alice");
    const token = lastToken();
    getDb().prepare(`UPDATE password_resets SET expires_at = 1`).run();
    expect((await reset(token, "brand-new-pass")).statusCode).toBe(400);
    expect((await reset("not-a-token", "brand-new-pass")).statusCode).toBe(400);
  });

  it("keeps the link usable after a too-weak password", async () => {
    await forgot("alice");
    const token = lastToken();
    expect((await reset(token, "short")).statusCode).toBe(400);
    expect((await reset(token, "long-enough-1")).statusCode).toBe(200);
  });
});