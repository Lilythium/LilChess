import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { closeDb, getDb, openDb } from "../db/connection.js";
import { registerUser } from "../testing/helpers.js";

describe("GET /api/tournaments?scope=active (lobby feed)", () => {
  let app: FastifyInstance;
  let alice: string;

  const list = async (qs = "") =>
    (await app.inject({ method: "GET", url: `/api/tournaments${qs}`, cookies: { sessionId: alice } })).json()
      .tournaments as { id: string; name: string; status: string }[];

  async function make(name: string, startsAt?: number): Promise<string> {
    const res = await app.inject({
      method: "POST", url: "/api/tournaments", cookies: { sessionId: alice },
      payload: { name, mode: "live", initialMs: 300_000, incrementMs: 0, maxPlayers: 4, startsAt },
    });
    expect(res.statusCode, res.body).toBe(200);
    return res.json().tournamentId as string;
  }
  const setStatus = (id: string, status: string) =>
    getDb().prepare(`UPDATE tournaments SET status = ? WHERE id = ?`).run(status, id);

  beforeEach(async () => {
    openDb(":memory:");
    app = await buildApp();
    alice = await registerUser(app, "alice");
    const soon = Date.now() + 3_600_000;
    // A creator may have at most 3 active tournaments, so retire each one before making the next.
    const done = await make("Finished one");
    setStatus(done, "completed");
    const gone = await make("Cancelled one");
    setStatus(gone, "cancelled");
    const running = await make("In progress");
    setStatus(running, "running");
    await make("Sooner open", soon);
    await make("Later open", soon + 3_600_000);
  });
  afterEach(async () => {
    await app.close();
    closeDb();
  });

  it("returns only open and running tournaments: running first, then soonest start", async () => {
    expect((await list("?scope=active")).map((t) => t.name)).toEqual(["In progress", "Sooner open", "Later open"]);
  });

  it("honours limit", async () => {
    expect((await list("?scope=active&limit=2")).map((t) => t.name)).toEqual(["In progress", "Sooner open"]);
  });

  it("still returns everything (newest first within status) by default", async () => {
    const all = await list();
    expect(all).toHaveLength(5);
    expect(all.map((t) => t.status).slice(0, 3)).toEqual(["running", "open", "open"]);
  });

  it("rejects bad query values", async () => {
    const res = await app.inject({ method: "GET", url: "/api/tournaments?scope=nope", cookies: { sessionId: alice } });
    expect(res.statusCode).toBe(400);
    const res2 = await app.inject({ method: "GET", url: "/api/tournaments?limit=0", cookies: { sessionId: alice } });
    expect(res2.statusCode).toBe(400);
  });
});
