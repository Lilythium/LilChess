import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const version = JSON.parse(read("mobile/version.json")) as { versionName: unknown; buildNumber: unknown };

describe("release version", () => {
  it("is a valid store version", () => {
    expect(version.versionName).toMatch(/^\d+\.\d+\.\d+$/);
    expect(Number.isSafeInteger(version.buildNumber) && (version.buildNumber as number) >= 1).toBe(true);
  });

  it("is the version iOS builds (run `npm run version:sync -w mobile` if this fails)", () => {
    const pbx = read("mobile/ios/App/App.xcodeproj/project.pbxproj");
    const marketing = [...pbx.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map((m) => m[1]);
    const build = [...pbx.matchAll(/CURRENT_PROJECT_VERSION = ([^;]+);/g)].map((m) => m[1]);
    expect(marketing.length).toBeGreaterThan(0);
    expect(new Set(marketing)).toEqual(new Set([version.versionName]));
    expect(new Set(build)).toEqual(new Set([String(version.buildNumber)]));
  });

  it("is the version Android builds, from the same file", () => {
    const gradle = read("mobile/android/app/build.gradle");
    expect(gradle).toContain("rootProject.file('../version.json')");
    expect(gradle).toContain("releaseVersion.buildNumber");
    expect(gradle).toContain("releaseVersion.versionName");
    expect(existsSync(resolve(root, "mobile/android/../version.json"))).toBe(true);
  });
});

describe("release hygiene", () => {
  it("keeps signing material and release credentials out of git", () => {
    const ignore = read("mobile/.gitignore");
    for (const pattern of ["*.jks", "*.keystore", "keystore.properties", "*.p12", "*.mobileprovision", "*.p8", "google-services.json"]) {
      expect(ignore).toContain(pattern);
    }
    expect(existsSync(resolve(root, "mobile/android/keystore.properties"))).toBe(false);
  });

  it("documents a demo address that is https, and ships no real one by accident", () => {
    const example = read("web/.env.native.example");
    expect(example).toMatch(/^VITE_LILCHESS_DEMO_URL=https:\/\//m);
    expect(existsSync(resolve(root, "web/.env.native"))).toBe(false);
  });
});
