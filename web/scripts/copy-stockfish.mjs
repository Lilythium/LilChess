// Copies the single-threaded "lite" Stockfish WASM build into web/public/stockfish/ so Vite serves it in dev and
// ships it in web/dist. Runs before `vite` and `vite build` (see the predev/prebuild scripts).
//
// Where the engine comes from is chosen by LILCHESS_STOCKFISH_SOURCE:
//   npm       (default) the prebuilt files in the `stockfish` npm package. Web, Docker and CI builds.
//   compiled  files built from pinned source by `npm run build:stockfish -w web`. Required for F-Droid.
// A missing engine is always an error: this script never falls back to the other source or skips the engine.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { env, stdout } from "node:process";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const outDir = join(here, "..", "public", "stockfish");
const pins = JSON.parse(readFileSync(join(here, "..", "stockfish-source", "pins.json"), "utf8"));
const base = pins.outputBase;

const source = env.LILCHESS_STOCKFISH_SOURCE ?? "npm";
if (source !== "npm" && source !== "compiled") {
  throw new Error(`LILCHESS_STOCKFISH_SOURCE must be "npm" or "compiled", got ${JSON.stringify(source)}`);
}

let fromDir;
let label;
if (source === "compiled") {
  fromDir = join(here, "..", "stockfish-build", "out");
  const manifestPath = join(fromDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`No compiled engine at ${fromDir}. Run \`npm run build:stockfish -w web\` first.`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.commit !== pins.commit) {
    throw new Error(`Compiled engine was built from ${manifest.commit}, pins.json says ${pins.commit}. Rebuild it.`);
  }
  if (!manifest.pinnedMatch && env.LILCHESS_ALLOW_UNPINNED_ENGINE !== "1") {
    throw new Error(`Compiled engine used emscripten ${manifest.emscripten}, not the pinned ${pins.emscripten}. Rebuild with the pinned toolchain.`);
  }
  label = `compiled from ${pins.commit.slice(0, 12)} (emscripten ${manifest.emscripten})`;
} else {
  const pkgJson = require.resolve("stockfish/package.json");
  const { buildVersion, version } = JSON.parse(readFileSync(pkgJson, "utf8"));
  if (`stockfish-${buildVersion}-lite-single` !== base) {
    throw new Error(`stockfish@${version} builds ${buildVersion}, but pins.json expects ${base}. Update both together.`);
  }
  fromDir = join(dirname(pkgJson), "bin");
  label = `npm stockfish@${version}`;
}

mkdirSync(outDir, { recursive: true });
for (const ext of [".js", ".wasm"]) {
  const from = join(fromDir, base + ext);
  if (!existsSync(from)) throw new Error(`Missing ${from} (${label}).`);
  copyFileSync(from, join(outDir, base + ext));
}
stdout.write(`stockfish (${label}): copied ${base}.{js,wasm} -> public/stockfish/\n`);
