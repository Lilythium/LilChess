// Copies the single-threaded "lite" Stockfish WASM build from node_modules into
// web/public/stockfish/ so Vite serves it in dev and ships it in web/dist.
// Runs before `vite` and `vite build` (see the predev/prebuild scripts).
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { stdout } from "node:process";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const pkgJson = require.resolve("stockfish/package.json");
const { buildVersion, version } = JSON.parse(readFileSync(pkgJson, "utf8"));
const binDir = join(dirname(pkgJson), "bin");
const outDir = join(here, "..", "public", "stockfish");
const base = `stockfish-${buildVersion}-lite-single`;

mkdirSync(outDir, { recursive: true });
for (const ext of [".js", ".wasm"]) {
  const from = join(binDir, base + ext);
  if (!existsSync(from)) throw new Error(`Missing ${from}. Is stockfish@${version} installed?`);
  copyFileSync(from, join(outDir, base + ext));
}
stdout.write(`stockfish ${version}: copied ${base}.{js,wasm} -> public/stockfish/\n`);
