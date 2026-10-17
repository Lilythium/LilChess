import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
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
      features: { guests: boolean; registration: string };
    };
    expect(body).toMatchObject({
      ok: true,
      app: "lilchess",
      version: expect.stringMatching(/^\d+\.\d+\.\d+/),
      apiVersion: 1,
      features: {
        guests: config.allowGuests,
        registration: config.registration,
      },
    });
    expect(body).not.toHaveProperty("inviteCode");
  });
});
