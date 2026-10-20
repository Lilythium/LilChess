import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { closeDb, getDb, openDb } from "../db/connection.js";
import { registerUser } from "../testing/helpers.js";

const HOUR = 3_600_000;
const LIVE = { mode: "live", initialMs: 300_000, incrementMs: 0 };
const CORR = { mode: "correspondence", daysPerMove: 3 };

describe("challenge lifecycle", () => {
  let app: FastifyInstance;
  let alice: string;

  const create = (payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: "/api/challenges", cookies: { sessionId: alice }, payload });
  const rows = () =>
    getDb().prepare(`SELECT id, mode, created_at, expires_at, rated FROM challenges`).all() as
      { id: string; mode: string; created_at: number; expires_at: number; rated: number }[];

  beforeEach(async () => {
    openDb(":memory:");
    app = await buildApp();
    alice = await registerUser(app, "alice");
  });
  afterEach(async () => {
    await app.close();
    closeDb();
  });

  it("expires live challenges (links included) after 1 hour", async () => {
    await create(LIVE);
    await create({ ...LIVE, link: true });
    for (const r of rows()) expect(r.expires_at - r.created_at).toBe(HOUR);
  });

  it("expires correspondence challenges after 2 days", async () => {
    await create(CORR);
    const [r] = rows();
    expect(r!.expires_at - r!.created_at).toBe(48 * HOUR);
  });

  it("allows one 72-hour direct challenge per recipient without replacing open challenges", async () => {
    await registerUser(app, "bob");
    await registerUser(app, "carol");

    const bobLive = (await create({ ...LIVE, toUsername: "bob" })).json().challengeId as string;
    const bobCorrespondence = (await create({ ...CORR, toUsername: "bob" })).json().challengeId as string;
    const carolLive = (await create({ ...LIVE, toUsername: "carol" })).json().challengeId as string;
    const openLive = (await create(LIVE)).json().challengeId as string;
    const openCorrespondence = (await create(CORR)).json().challengeId as string;

    expect(rows().map((r) => r.id).sort()).toEqual(
      [bobCorrespondence, carolLive, openLive, openCorrespondence].sort(),
    );
    expect(rows().find((r) => r.id === bobLive)).toBeUndefined();
    for (const r of rows().filter((row) => row.id === bobCorrespondence || row.id === carolLive)) {
      expect(r.expires_at - r.created_at).toBe(72 * HOUR);
    }
    expect(rows().find((r) => r.id === openLive)!.expires_at - rows().find((r) => r.id === openLive)!.created_at)
      .toBe(HOUR);
    expect(rows().find((r) => r.id === openCorrespondence)!.expires_at - rows().find((r) => r.id === openCorrespondence)!.created_at)
      .toBe(48 * HOUR);
  });

  it("a new live challenge replaces the old one, whatever its kind", async () => {
    await create(LIVE);
    const second = (await create({ ...LIVE, link: true })).json().challengeId as string;
    expect(rows().map((r) => r.id)).toEqual([second]);
  });

  it("keeps one live and one correspondence challenge side by side", async () => {
    await create(LIVE);
    await create(CORR);
    await create(LIVE);
    await create(CORR);
    expect(rows().map((r) => r.mode).sort()).toEqual(["correspondence", "live"]);
  });

  it("carries a rated challenge into the accepted game", async () => {
    const bob = await registerUser(app, "bob");
    const challengeId = (await create({ ...LIVE, rated: true })).json().challengeId as string;
    expect(rows()[0]?.rated).toBe(1);

    const accepted = await app.inject({
      method: "POST", url: `/api/challenges/${challengeId}/accept`, cookies: { sessionId: bob },
    });
    expect(accepted.statusCode).toBe(200);
    const game = getDb().prepare(`SELECT rated FROM games WHERE id = ?`).get(accepted.json().gameId) as { rated: number };
    expect(game.rated).toBe(1);
  });

  it("refuses to accept an expired challenge", async () => {
    const bob = await registerUser(app, "bob");
    const id = (await create(LIVE)).json().challengeId as string;
    getDb().prepare(`UPDATE challenges SET expires_at = 1 WHERE id = ?`).run(id);
    const res = await app.inject({ method: "POST", url: `/api/challenges/${id}/accept`, cookies: { sessionId: bob } });
    expect(res.statusCode).toBe(410);
  });
});