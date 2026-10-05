import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    isolate: false,
    exclude: ["**/node_modules/**", "**/dist/**", "**/.git/**"],
  },
});