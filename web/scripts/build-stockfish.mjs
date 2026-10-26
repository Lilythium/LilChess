// Builds the single-threaded "lite" Stockfish WASM engine from pinned source, for builds that must not ship the
// prebuilt binary from the `stockfish` npm package (F-Droid). Everything it uses is pinned in
// web/stockfish-source/pins.json: the stockfish.js commit, the emscripten version and the NNUE net.
//
//   node web/scripts/build-stockfish.mjs                   build (needs emcc 3.1.7 on PATH)
//   node web/scripts/build-stockfish.mjs --fetch-net       first download and verify the net into web/stockfish-source/nets/
//   node web/scripts/build-stockfish.mjs --allow-em-mismatch   experiments only: other emscripten version; the manifest
//                                                          records it and copy-stockfish.mjs refuses it for releases
//   node web/scripts/build-stockfish.mjs --emcc /path/to/emcc
//
// Output: web/stockfish-build/out/<outputBase>.{js,wasm} and manifest.json (git-ignored). The source checkout in
// web/stockfish-build/src is deleted and re-fetched every run, so a build never reuses unpinned state.
import { execFileSync, spawnSync } from "node:child_process";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { argv, exit, stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const pins = JSON.parse(readFileSync(join(web, "stockfish-source", "pins.json"), "utf8"));
const netPath = join(web, "stockfish-source", "nets", pins.net.file);
const workDir = join(web, "stockfish-build");
const srcDir = join(workDir, "src");
const outDir = join(workDir, "out");

const flag = (name) => argv.includes(name);
const option = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const emcc = option("--emcc") ?? "emcc";

function fail(message) {
  stderr.write(`build-stockfish: ${message}\n`);
  exit(1);
}

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

/** A Stockfish net is named after the first 12 hex digits of its own SHA-256. */
function netIsValid(buffer) {
  return sha256(buffer).startsWith(pins.net.sha256Prefix) && pins.net.file === `nn-${pins.net.sha256Prefix}.nnue`;
}

async function ensureNet() {
  if (existsSync(netPath)) {
    if (!netIsValid(readFileSync(netPath))) fail(`${netPath} does not match its checksum (${pins.net.sha256Prefix}...). Delete it and re-fetch.`);
    return;
  }
  if (!flag("--fetch-net")) {
    fail(`${pins.net.file} is not committed at ${netPath}.\nRun once with --fetch-net (downloads ${pins.net.url} and verifies its checksum), then commit the file.`);
  }
  const response = await globalThis.fetch(pins.net.url);
  if (!response.ok) fail(`download failed: HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!netIsValid(buffer)) fail(`downloaded net has SHA-256 ${sha256(buffer)}, expected it to start with ${pins.net.sha256Prefix}. Not saved.`);
  mkdirSync(dirname(netPath), { recursive: true });
  writeFileSync(netPath, buffer);
  stdout.write(`saved ${netPath} (${buffer.length} bytes, sha256 ${sha256(buffer)})\n`);
}

function emscriptenVersion() {
  try {
    const text = execFileSync(emcc, ["--version"], { encoding: "utf8" });
    return /\b(\d+\.\d+\.\d+)\b/.exec(text)?.[1] ?? "unknown";
  } catch {
    fail(`could not run \`${emcc} --version\`. Install emscripten ${pins.emscripten} (emsdk install ${pins.emscripten}) or pass --emcc.`);
  }
}

function fetchSource() {
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(srcDir, { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: srcDir, stdio: "inherit" });
  git("init", "--quiet");
  git("fetch", "--quiet", "--depth", "1", pins.repository, pins.commit);
  git("checkout", "--quiet", "--detach", "FETCH_HEAD");
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: srcDir, encoding: "utf8" }).trim();
  if (head !== pins.commit) fail(`fetched ${head}, expected pinned ${pins.commit}`);
}

await ensureNet();

const em = emscriptenVersion();
const pinnedMatch = em === pins.emscripten;
if (!pinnedMatch) {
  if (!flag("--allow-em-mismatch")) fail(`emscripten ${em} found, ${pins.emscripten} required (pinned). Use --allow-em-mismatch only for local experiments.`);
  stderr.write(`WARNING: emscripten ${em} instead of ${pins.emscripten}. The output is not release-grade.\n`);
}

fetchSource();
copyFileSync(netPath, join(srcDir, pins.net.file)); // build.js embeds src/<net file>; with --lite it never downloads one
const build = spawnSync("node", ["build.js", ...pins.buildFlags, "--do-not-verify-nets", "--emcc", emcc, "--skip-em-check"], {
  cwd: srcDir,
  stdio: "inherit",
});
if (build.status !== 0) fail(`stockfish.js build failed (exit ${build.status})`);

mkdirSync(outDir, { recursive: true });
// The engine is a CommonJS file, but web/package.json says "type": "module". Without this, Node (the integration
// tests and compare-stockfish.mjs load the engine with require) would refuse to run it. The browser ignores it.
writeFileSync(join(outDir, "package.json"), '{ "type": "commonjs" }\n');
const files = {};
for (const ext of [".js", ".wasm"]) {
  const from = join(srcDir, "src", pins.outputBase + ext);
  if (!existsSync(from)) fail(`expected build output ${from} is missing`);
  const to = join(outDir, pins.outputBase + ext);
  copyFileSync(realpathSync(from), to);
  files[pins.outputBase + ext] = sha256(readFileSync(to));
}
writeFileSync(
  join(outDir, "manifest.json"),
  JSON.stringify({ commit: pins.commit, emscripten: em, pinnedMatch, net: pins.net.file, files }, null, 2) + "\n",
);
stdout.write(`built ${pins.outputBase} from ${pins.commit.slice(0, 12)} with emscripten ${em}${pinnedMatch ? "" : " (NOT the pinned version)"}\n`);
