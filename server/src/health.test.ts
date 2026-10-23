import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { MIN_CLIENT_API_VERSION, SERVER_API_VERSION } from "./compat.js";
import { config } from "./config.js";

describe("GET /api/health", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("identifies LilChess and declares the mobile API contract and configured features", async () => {
    const response = await app.inject({ method: "GET", url: "/api/health" });
    expect(response.statusCode).toBe(200);

    const body = response.json() as {
      ok: boolean;
      app: string;
      version: string;
      apiVersion: number;
      minClientApiVersion: number;
      features: { guests: boolean; registration: string; demo: boolean; accountDeletion: boolean };
    };
    expect(body).toMatchObject({
      ok: true,
      app: "lilchess",
      version: expect.stringMatching(/^\d+\.\d+\.\d+/),
      apiVersion: SERVER_API_VERSION,
      minClientApiVersion: MIN_CLIENT_API_VERSION,
      features: {
        guests: config.allowGuests,
        registration: config.registration,
        demo: config.demoMode,
        accountDeletion: true,
      },
    });
    expect(body).not.toHaveProperty("inviteCode");
  });

  it("keeps the declared compatibility range coherent", () => {
    expect(Number.isInteger(SERVER_API_VERSION)).toBe(true);
    expect(Number.isInteger(MIN_CLIENT_API_VERSION)).toBe(true);
    expect(MIN_CLIENT_API_VERSION).toBeGreaterThanOrEqual(1);
    expect(MIN_CLIENT_API_VERSION).toBeLessThanOrEqual(SERVER_API_VERSION);
  });

  it("keeps the top-level shape stable: a new top-level field needs a compatibility review (docs/mobile-compatibility.md)", async () => {
    const body = (await app.inject({ method: "GET", url: "/api/health" })).json() as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["apiVersion", "app", "features", "minClientApiVersion", "ok", "version"]);
  });
});
