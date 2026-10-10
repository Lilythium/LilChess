import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  use: {
    baseURL:
      (globalThis as typeof globalThis & {
        process?: { env?: Record<string, string | undefined> };
      }).process?.env?.BASE_URL ?? "http://localhost:5173",
  },
});