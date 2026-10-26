import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const script = join(repo, "mobile", "scripts", "check-fastlane.mjs");
const locale = ["fastlane", "metadata", "android", "en-US"];

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

/** A throwaway checkout holding only what the checker reads. */
function checkout(): string {
  const root = mkdtempSync(join(tmpdir(), "lilchess-fastlane-"));
  roots.push(root);
  cpSync(join(repo, ...locale), join(root, ...locale), { recursive: true });
  mkdirSync(join(root, "mobile"));
  cpSync(join(repo, "mobile", "version.json"), join(root, "mobile", "version.json"));
  return root;
}
const check = (root: string, ...args: string[]) => spawnSync("node", [script, "--root", root, ...args], { encoding: "utf8" });

describe("F-Droid Fastlane metadata", () => {
  it("passes the structure and limit checks in the repository", () => {
    const result = check(repo);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it("links to a privacy document that exists", () => {
    const text = readFileSync(join(repo, ...locale, "full_description.txt"), "utf8");
    expect(text).toContain("/docs/mobile-privacy.md");
    expect(readFileSync(join(repo, "docs", "mobile-privacy.md"), "utf8")).toContain("LilChess Mobile");
  });

  it("is blocked from release while placeholders and screenshots are missing", () => {
    const result = check(repo, "--release");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("REPLACE_WITH_DEMO_ADDRESS");
  });

  it("passes the release checks once the demo address and screenshots are in", () => {
    const root = checkout();
    const file = join(root, ...locale, "full_description.txt");
    writeFileSync(file, readFileSync(file, "utf8").replace("REPLACE_WITH_DEMO_ADDRESS", "https://demo.example.org"));
    const shots = join(root, ...locale, "images", "phoneScreenshots");
    mkdirSync(shots, { recursive: true });
    writeFileSync(join(shots, "1.png"), "x");
    writeFileSync(join(shots, "2.png"), "x");
    expect(check(root, "--release").status).toBe(0);
  });

  it.each([
    ["a missing changelog for the current versionCode", (root: string) => rmSync(join(root, ...locale, "changelogs", "1.txt")), "changelogs/1.txt is missing"],
    ["an over-long short description", (root: string) => writeFileSync(join(root, ...locale, "short_description.txt"), "x".repeat(81)), "short description"],
    ["a tag F-Droid does not render", (root: string) => appendTo(join(root, ...locale, "full_description.txt"), "<script>x</script>"), "<script>"],
    ["a claim that drops the HTTPS-only statement", (root: string) => replaceIn(join(root, ...locale, "full_description.txt"), /HTTPS/g, "TLS"), "HTTPS-only"],
    ["naming another chess service", (root: string) => appendTo(join(root, ...locale, "full_description.txt"), "Like lichess."), "affiliation"],
    ["promising tournaments on the demo", (root: string) => replaceIn(join(root, ...locale, "full_description.txt"), /tournaments and simuls\. Servers/, "chats. Servers"), "tournaments"],
  ])("rejects %s", (_name, mutate, message) => {
    const root = checkout();
    mutate(root);
    const result = check(root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(message);
  });
});

function appendTo(path: string, text: string): void {
  writeFileSync(path, readFileSync(path, "utf8") + text);
}
function replaceIn(path: string, pattern: RegExp, text: string): void {
  writeFileSync(path, readFileSync(path, "utf8").replace(pattern, text));
}
