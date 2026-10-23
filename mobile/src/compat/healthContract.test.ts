import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  MAX_API_VERSION,
  MIN_API_VERSION,
  ServerSelectionError,
  validateHealthResponse,
  type ServerSelectionErrorCode,
} from "../serverSelection.js";

// Recorded /api/health responses, one per server generation, run through the app's validator on every CI run.
// This is the automated half of "periodically test supported server versions" (docs/mobile-compatibility.md): when the
// app's rules change, or when a server release changes /api/health, a fixture here fails before a person does.

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..", "..");
const fixture = (name: string): unknown => JSON.parse(readFileSync(resolve(here, "health", name), "utf8"));
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

type Expectation =
  | { ok: true; apiVersion: number; minClientApiVersion: number; demo: boolean; accountDeletion: boolean }
  | { ok: false; code: ServerSelectionErrorCode; action?: "update-server" | "update-app"; message: RegExp };

const expectations: Record<string, Expectation> = {
  "v1-initial.json": { ok: true, apiVersion: 1, minClientApiVersion: 1, demo: false, accountDeletion: false },
  "v1-demo.json": { ok: true, apiVersion: 1, minClientApiVersion: 1, demo: true, accountDeletion: false },
  "current.json": { ok: true, apiVersion: 1, minClientApiVersion: 1, demo: false, accountDeletion: true },
  "future-additive.json": { ok: true, apiVersion: 2, minClientApiVersion: 1, demo: false, accountDeletion: true },
  "future-breaking.json": { ok: false, code: "incompatible", action: "update-app", message: /needs a newer version of this app/ },
  "pre-api-version.json": { ok: false, code: "incompatible", action: "update-server", message: /does not report an API version/ },
  "not-lilchess.json": { ok: false, code: "not-lilchess", message: /did not identify itself as a LilChess server/ },
  "bad-range.json": { ok: false, code: "invalid-response", message: /invalid API compatibility range/ },
};

describe("recorded server health responses", () => {
  it.each(Object.entries(expectations))("%s", (name, expected) => {
    const payload = fixture(name);
    if (expected.ok) {
      const health = validateHealthResponse(payload);
      expect(health.apiVersion).toBe(expected.apiVersion);
      expect(health.minClientApiVersion).toBe(expected.minClientApiVersion);
      expect(health.features.demo).toBe(expected.demo);
      expect(health.features.accountDeletion).toBe(expected.accountDeletion);
      return;
    }
    let caught: unknown;
    try {
      validateHealthResponse(payload);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ServerSelectionError);
    const error = caught as ServerSelectionError;
    expect(error.code).toBe(expected.code);
    expect(error.action).toBe(expected.action);
    expect(error.message).toMatch(expected.message);
  });

  it("has an expectation for every fixture, so none is added and forgotten", () => {
    const files = readdirSync(resolve(here, "health")).filter((f) => f.endsWith(".json")).sort();
    expect(files).toEqual(Object.keys(expectations).sort());
  });
});

describe("the server's declared API contract", () => {
  const source = read("server/src/compat.ts");
  const constant = (name: string): number => {
    const match = source.match(new RegExp(`export const ${name} = (\\d+);`));
    if (!match?.[1]) throw new Error(`${name} not found in server/src/compat.ts`);
    return Number(match[1]);
  };
  const serverApi = constant("SERVER_API_VERSION");
  const serverMin = constant("MIN_CLIENT_API_VERSION");

  it("is accepted by this app", () => {
    const health = validateHealthResponse({
      ok: true,
      app: "lilchess",
      version: "1.0.0",
      apiVersion: serverApi,
      minClientApiVersion: serverMin,
      features: { guests: true, registration: "open" },
    });
    expect(health.apiVersion).toBe(serverApi);
  });

  it("is what the recorded current response says", () => {
    const current = fixture("current.json") as { apiVersion: number; minClientApiVersion: number };
    expect(current.apiVersion).toBe(serverApi);
    expect(current.minClientApiVersion).toBe(serverMin);
  });

  it("does not drop the API level the newest app ships with", () => {
    // A server that raises MIN_CLIENT_API_VERSION above MAX_API_VERSION locks out every app already released.
    expect(serverMin).toBeLessThanOrEqual(MAX_API_VERSION);
    expect(serverApi).toBeGreaterThanOrEqual(MIN_API_VERSION);
  });

  it("matches the numbers written down in docs/mobile-compatibility.md", () => {
    const doc = read("docs/mobile-compatibility.md");
    expect(doc).toContain(`Current server API version: **${serverApi}**`);
    expect(doc).toContain(`Oldest app API level the server serves: **${serverMin}**`);
    expect(doc).toContain(`App supports server API versions: **${MIN_API_VERSION}** to **${MAX_API_VERSION}**`);
  });
});
