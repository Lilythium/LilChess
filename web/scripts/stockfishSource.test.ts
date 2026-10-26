import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pins = JSON.parse(readFileSync(join(web, "stockfish-source", "pins.json"), "utf8")) as {
  tag: string;
  commit: string;
  emscripten: string;
  outputBase: string;
  buildFlags: string[];
  net: { file: string; sha256Prefix: string; url: string };
};

describe("stockfish-source/pins.json", () => {
  it("pins everything the build needs", () => {
    expect(pins.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(pins.emscripten).toBe("3.1.7");
    expect(pins.net.sha256Prefix).toMatch(/^[0-9a-f]{12}$/);
    expect(pins.net.file).toBe(`nn-${pins.net.sha256Prefix}.nnue`);
    expect(pins.net.url.startsWith("https://")).toBe(true);
    expect(pins.buildFlags).toEqual(["--single-threaded", "--lite"]);
    expect(pins.outputBase).toBe("stockfish-18-lite-single");
  });

  it("matches the version of the stockfish npm package it is compared against", () => {
    const pkg = JSON.parse(readFileSync(join(web, "package.json"), "utf8")) as { devDependencies: Record<string, string> };
    expect(pkg.devDependencies.stockfish).toBe(pins.tag.replace(/^v/, ""));
  });

  it.runIf(existsSync(join(web, "stockfish-source", "nets", pins.net.file)))("committed net hashes to its file name", () => {
    const digest = createHash("sha256").update(readFileSync(join(web, "stockfish-source", "nets", pins.net.file))).digest("hex");
    expect(digest.startsWith(pins.net.sha256Prefix)).toBe(true);
  });
});

describe("engine scripts", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
  });

  /** A throwaway copy of web/ (scripts and pins only), so tests never touch real build output. */
  function tree(): string {
    const root = mkdtempSync(join(tmpdir(), "lilchess-sf-"));
    roots.push(root);
    cpSync(join(web, "scripts"), join(root, "scripts"), { recursive: true });
    cpSync(join(web, "stockfish-source", "pins.json"), join(root, "stockfish-source", "pins.json"));
    return root;
  }
  const run = (root: string, script: string, env: Record<string, string> = {}, args: string[] = []) =>
    spawnSync("node", [join(root, "scripts", script), ...args], { encoding: "utf8", env: { ...process.env, ...env } });

  function fakeBuild(root: string, manifest: Record<string, unknown>, files = [".js", ".wasm"]): void {
    const out = join(root, "stockfish-build", "out");
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "manifest.json"), JSON.stringify({ commit: pins.commit, emscripten: "3.1.7", pinnedMatch: true, ...manifest }));
    for (const ext of files) writeFileSync(join(out, pins.outputBase + ext), "x");
  }

  it("copy-stockfish rejects an unknown source and never falls back silently", () => {
    const root = tree();
    const bad = run(root, "copy-stockfish.mjs", { LILCHESS_STOCKFISH_SOURCE: "download" });
    expect(bad.status).not.toBe(0);
    expect(bad.stderr).toContain("must be");
    const missing = run(root, "copy-stockfish.mjs", { LILCHESS_STOCKFISH_SOURCE: "compiled" });
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toContain("build:stockfish");
    expect(existsSync(join(root, "public", "stockfish"))).toBe(false);
  });

  it("copy-stockfish copies a matching compiled engine", () => {
    const root = tree();
    fakeBuild(root, {});
    const result = run(root, "copy-stockfish.mjs", { LILCHESS_STOCKFISH_SOURCE: "compiled" });
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("compiled from");
    expect(existsSync(join(root, "public", "stockfish", `${pins.outputBase}.wasm`))).toBe(true);
  });

  it("copy-stockfish refuses a stale, off-version or incomplete compiled engine", () => {
    let root = tree();
    fakeBuild(root, { commit: "0".repeat(40) });
    expect(run(root, "copy-stockfish.mjs", { LILCHESS_STOCKFISH_SOURCE: "compiled" }).stderr).toContain("Rebuild");

    root = tree();
    fakeBuild(root, { emscripten: "3.1.6", pinnedMatch: false });
    expect(run(root, "copy-stockfish.mjs", { LILCHESS_STOCKFISH_SOURCE: "compiled" }).stderr).toContain("pinned");
    expect(run(root, "copy-stockfish.mjs", { LILCHESS_STOCKFISH_SOURCE: "compiled", LILCHESS_ALLOW_UNPINNED_ENGINE: "1" }).status).toBe(0);

    root = tree();
    fakeBuild(root, {}, [".js"]);
    expect(run(root, "copy-stockfish.mjs", { LILCHESS_STOCKFISH_SOURCE: "compiled" }).stderr).toContain("Missing");
  });

  it("build-stockfish stops before touching the network or the toolchain when the net is absent or corrupt", () => {
    const root = tree();
    const missing = run(root, "build-stockfish.mjs");
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toContain("--fetch-net");

    mkdirSync(join(root, "stockfish-source", "nets"), { recursive: true });
    writeFileSync(join(root, "stockfish-source", "nets", pins.net.file), "not a net");
    const corrupt = run(root, "build-stockfish.mjs");
    expect(corrupt.status).not.toBe(0);
    expect(corrupt.stderr).toContain("does not match its checksum");
  });
});
