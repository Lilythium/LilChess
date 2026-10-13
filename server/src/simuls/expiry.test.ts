import type { FastifyInstance } from "fastify";
import { SIMUL_PENDING_TTL_MS } from "@lilchess/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { closeDb, getDb, openDb } from "../db/connection.js";
import { purgeExpired } from "../maintenance.js";
import { registerUser } from "../testing/helpers.js";
import { expirePendingSimuls } from "./service.js";

describe("pending simul expiry", () => {
  let app: FastifyInstance;
  let host: string;

  const call = (sid: string, method: "GET" | "POST", url: string, payload?: object) =>
    app.inject({ method, url, cookies: { sessionId: sid }, payload });

  const live = { name: "Live simul", mode: "live", initialMs: 300_000, incrementMs: 0, maxPlayers: 4 };
  const corr = { name: "Corr simul", mode: "correspondence", daysPerMove: 3, maxPlayers: 4 };

  async function create(sid: string, body: object): Promise<string> {
    const res = await call(sid, "POST", "/api/simuls", body);
    expect(res.statusCode, res.body).toBe(200);
    return res.json().simulId as string;
  }
  const age = (id: string, ms: number) =>
    getDb().prepare(`UPDATE simuls SET created_at = created_at - ? WHERE id = ?`).run(ms, id);
  const status = (id: string) =>
    (getDb().prepare(`SELECT status FROM simuls WHERE id = ?`).get(id) as { status: string }).status;

  beforeEach(async () => {
    openDb(":memory:");
    app = await buildApp();
    host = await registerUser(app, "hana");
  });
  afterEach(async () => {
    await app.close();
    closeDb();
  });

  it("cancels an open live simul after its TTL but not before", async () => {
    const id = await create(host, live);
    age(id, SIMUL_PENDING_TTL_MS.live - 60_000);
    expect(expirePendingSimuls()).toBe(0);
    expect(status(id)).toBe("open");

    age(id, 120_000);
    expect(expirePendingSimuls()).toBe(1);
    expect(status(id)).toBe("cancelled");
    expect(getDb().prepare(`SELECT ended_at FROM simuls WHERE id = ?`).get(id)).not.toEqual({ ended_at: null });
  });

  it("gives correspondence simuls a longer TTL than live ones", async () => {
    const id = await create(host, corr);
    age(id, SIMUL_PENDING_TTL_MS.live * 2); // would have killed a live simul
    expect(expirePendingSimuls()).toBe(0);
    expect(status(id)).toBe("open");

    age(id, SIMUL_PENDING_TTL_MS.correspondence);
    expect(expirePendingSimuls()).toBe(1);
    expect(status(id)).toBe("cancelled");
  });

  it("never touches a simul that has started", async () => {
    const ann = await registerUser(app, "ann");
    const id = await create(host, live);
    await call(host, "POST", `/api/simuls/${id}/invite`, { usernames: ["ann"] });
    await call(ann, "POST", `/api/simuls/${id}/respond`, { accept: true });
    expect((await call(host, "POST", `/api/simuls/${id}/start`)).statusCode).toBe(200);
    age(id, SIMUL_PENDING_TTL_MS.correspondence * 2);
    expect(expirePendingSimuls()).toBe(0);
    expect(status(id)).toBe("running");
  });

  it("lets a host create a new simul right after their old one went stale", async () => {
    const stale = await create(host, live);
    expect((await call(host, "POST", "/api/simuls", live)).statusCode).toBe(409); // still active

    age(stale, SIMUL_PENDING_TTL_MS.live + 1_000);
    const fresh = await create(host, { ...live, name: "Second simul" });
    expect(status(stale)).toBe("cancelled");
    expect(status(fresh)).toBe("open");
  });

  it("drops expired simuls from the lists the lobby reads", async () => {
    const id = await create(host, live);
    const viewer = await registerUser(app, "ann");
    const open = async () => (await call(viewer, "GET", "/api/simuls")).json().open as { id: string }[];
    expect((await open()).map((s) => s.id)).toEqual([id]);

    age(id, SIMUL_PENDING_TTL_MS.live + 1_000);
    expirePendingSimuls();
    expect(await open()).toEqual([]);
  });

  it("is part of the hourly maintenance purge", async () => {
    const id = await create(host, live);
    age(id, SIMUL_PENDING_TTL_MS.live + 1_000);
    expect(purgeExpired().simuls).toBe(1);
    expect(status(id)).toBe("cancelled");
  });
});
