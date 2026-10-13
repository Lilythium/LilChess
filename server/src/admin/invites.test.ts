import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { config } from "../config.js";
import { closeDb, getDb, openDb } from "../db/connection.js";
import { normalizeInviteCode } from "../auth/invites.js";
import { registerUser } from "../testing/helpers.js";

describe("admin: registration invite codes", () => {
  let app: FastifyInstance;
  let admin: string;
  let player: string;
  const saved = { registration: config.registration, inviteCode: config.inviteCode };

  const createInvite = async (payload: object = {}) =>
    (await app.inject({ method: "POST", url: "/api/admin/invites", cookies: { sessionId: admin }, payload })).json().invite as
      { code: string; maxUses: number; uses: number; status: string; expiresAt: number | null; note: string | null };
  const register = (username: string, inviteCode?: string) =>
    app.inject({ method: "POST", url: "/api/register", payload: { username, password: "hunter22!", inviteCode } });
  const listed = async () =>
    (await app.inject({ method: "GET", url: "/api/admin/invites", cookies: { sessionId: admin } })).json().invites as
      { code: string; status: string; uses: number }[];

  beforeEach(async () => {
    openDb(":memory:");
    app = await buildApp();
    admin = await registerUser(app, "admin"); // registered while the server is still open
    player = await registerUser(app, "player");
    getDb().prepare(`UPDATE users SET is_admin = 1 WHERE username = 'admin'`).run();
    config.registration = "invite";
    config.inviteCode = "from-the-env";
  });
  afterEach(async () => {
    Object.assign(config, saved);
    await app.close();
    closeDb();
  });

  it("creates codes that let someone register, once by default", async () => {
    const invite = await createInvite({ note: "for Sam" });
    expect(invite).toMatchObject({ maxUses: 1, uses: 0, status: "active", expiresAt: null, note: "for Sam" });
    expect(invite.code).toMatch(/^[A-HJ-NP-Z2-9]{12}$/);

    expect((await register("sam", invite.code)).statusCode).toBe(200);
    const second = await register("sue", invite.code);
    expect(second.statusCode).toBe(403);
    expect(second.json().error).toBe("Invalid invite code");
    expect((await listed())[0]).toMatchObject({ code: invite.code, status: "used up", uses: 1 });
  });

  it("accepts the code typed in lower case, with dashes or spaces", async () => {
    const { code } = await createInvite();
    const typed = `${code.slice(0, 4)}-${code.slice(4, 8)} ${code.slice(8)}`.toLowerCase();
    expect(normalizeInviteCode(typed)).toBe(code);
    expect((await register("typed", typed)).statusCode).toBe(200);
  });

  it("supports several uses, and stops after the last", async () => {
    const { code } = await createInvite({ maxUses: 2 });
    expect((await register("one", code)).statusCode).toBe(200);
    expect((await register("two", code)).statusCode).toBe(200);
    expect((await register("three", code)).statusCode).toBe(403);
  });

  it("doesn't spend a use when the username is taken", async () => {
    const { code } = await createInvite();
    expect((await register("player", code)).statusCode).toBe(409);
    expect((await listed())[0]).toMatchObject({ status: "active", uses: 0 });
    expect((await register("fresh", code)).statusCode).toBe(200);
  });

  it("rejects revoked, expired, unknown and missing codes", async () => {
    const revoked = await createInvite();
    const revoke = await app.inject({ method: "POST", url: `/api/admin/invites/${revoked.code}/revoke`, cookies: { sessionId: admin } });
    expect(revoke.statusCode).toBe(200);
    expect((await register("user_one", revoked.code)).statusCode).toBe(403);

    const expiring = await createInvite({ expiresInDays: 1 });
    expect(expiring.expiresAt).toBeGreaterThan(Date.now());
    getDb().prepare(`UPDATE registration_invites SET expires_at = ? WHERE code = ?`).run(Date.now() - 1, expiring.code);
    expect((await register("user_two", expiring.code)).statusCode).toBe(403);

    expect((await register("user_three", "NOTACODE1234")).statusCode).toBe(403);
    expect((await register("user_four")).statusCode).toBe(403);
    expect((await listed()).map((i) => i.status).sort()).toEqual(["expired", "revoked"]);
  });

  it("keeps the INVITE_CODE from the environment working, and never uses a database code up for it", async () => {
    const { code } = await createInvite();
    expect((await register("envuser", "from-the-env")).statusCode).toBe(200);
    expect((await listed())[0]).toMatchObject({ code, uses: 0 });
  });

  it("only matters in invite mode", async () => {
    config.registration = "open";
    expect((await register("anyone")).statusCode).toBe(200);
    config.registration = "closed";
    const { code } = await createInvite();
    expect((await register("nope", code)).statusCode).toBe(403); // closed means admin-created only
  });

  it("validates what an admin asks for", async () => {
    const bad = async (payload: object) =>
      (await app.inject({ method: "POST", url: "/api/admin/invites", cookies: { sessionId: admin }, payload })).statusCode;
    expect(await bad({ maxUses: 0 })).toBe(400);
    expect(await bad({ maxUses: 5000 })).toBe(400);
    expect(await bad({ expiresInDays: 0 })).toBe(400);
    expect(await bad({ note: "x".repeat(81) })).toBe(400);
    expect(await bad({ maxUses: "many" })).toBe(400);
  });

  it("is for administrators, and revoking handles missing and repeated codes", async () => {
    expect((await app.inject({ method: "POST", url: "/api/admin/invites", cookies: { sessionId: player }, payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/admin/invites", cookies: { sessionId: player } })).statusCode).toBe(403);
    const revoke = (code: string) =>
      app.inject({ method: "POST", url: `/api/admin/invites/${code}/revoke`, cookies: { sessionId: admin } });
    expect((await revoke("ABCDEFGH2345")).statusCode).toBe(404);
    expect((await revoke("bad!")).statusCode).toBe(400);
    const { code } = await createInvite();
    expect((await revoke(code)).statusCode).toBe(200);
    expect((await revoke(code)).statusCode).toBe(409);
  });

  it("logs creating and revoking, and counts active codes in the stats", async () => {
    const keep = await createInvite({ maxUses: 3, note: "team" });
    const drop = await createInvite();
    await app.inject({ method: "POST", url: `/api/admin/invites/${drop.code}/revoke`, cookies: { sessionId: admin } });

    const stats = (await app.inject({ method: "GET", url: "/api/admin/stats", cookies: { sessionId: admin } })).json().stats;
    expect(stats.activeInviteCodes).toBe(1);

    const log = (await app.inject({ method: "GET", url: "/api/admin/audit", cookies: { sessionId: admin } })).json().entries as
      { action: string; target: string; details: string }[];
    expect(log.map((e) => [e.action, e.target])).toEqual([
      ["invite.revoke", `invite:${drop.code}`],
      ["invite.create", `invite:${drop.code}`],
      ["invite.create", `invite:${keep.code}`],
    ]);
    expect(JSON.parse(log[2]!.details)).toMatchObject({ note: "team", maxUses: 3, expiresAt: null });
  });
});