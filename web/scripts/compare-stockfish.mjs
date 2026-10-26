// Compares the engine compiled from pinned source with the prebuilt npm engine (same "lite single-threaded" flavour):
// same UCI output shape, and speed on the same fixed searches. Run it after `npm run build:stockfish -w web`.
//
//   node web/scripts/compare-stockfish.mjs [depth]
//
// It prints nodes per second for each engine and the ratio. The analysis tests are the other half of the comparison:
//   LILCHESS_STOCKFISH_ENGINE=$PWD/web/stockfish-build/out/stockfish-18-lite-single.js npx vitest run web/src/lib/analysis
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { argv, env, exit, stderr, stdout } from "node:process";
import { setTimeout } from "node:timers";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const depth = Number(argv[2] ?? 16);
const FENS = [
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 2 3",
  "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
  "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1",
];

async function measure(label, enginePath) {
  const init = require("stockfish");
  const engine = await init(enginePath);
  const lines = [];
  engine.listener = (line) => lines.push(String(line));
  const wait = (predicate) =>
    new Promise((resolve) => {
      const tick = () => (predicate() ? resolve() : setTimeout(tick, 20));
      tick();
    });
  engine.sendCommand("uci");
  await wait(() => lines.includes("uciok"));
  let nodes = 0;
  const started = performance.now();
  for (const fen of FENS) {
    lines.length = 0;
    engine.sendCommand("ucinewgame");
    engine.sendCommand(`position fen ${fen}`);
    engine.sendCommand(`go depth ${depth}`);
    await wait(() => lines.some((l) => l.startsWith("bestmove")));
    const last = [...lines].reverse().find((l) => l.startsWith("info") && l.includes(" nodes "));
    nodes += Number(/ nodes (\d+)/.exec(last ?? "")?.[1] ?? 0);
  }
  const seconds = (performance.now() - started) / 1000;
  const nps = Math.round(nodes / seconds);
  stdout.write(`${label}: ${nodes} nodes in ${seconds.toFixed(1)} s = ${nps} nps\n`);
  return nps;
}

const compiled = join(here, "..", "stockfish-build", "out", "stockfish-18-lite-single.js");
if (!existsSync(compiled)) {
  stderr.write("No compiled engine. Run `npm run build:stockfish -w web` first.\n");
  exit(1);
}
// One engine per process (the Node wrapper cannot be instantiated twice), so run this script once per engine:
const which = env.LILCHESS_COMPARE_WHICH;
if (which === "compiled") await measure("compiled", compiled);
else if (which === "npm") await measure("npm     ", "lite-single");
else {
  const { execFileSync } = await import("node:child_process");
  const run = (w) => Number(/= (\d+) nps/.exec(execFileSync("node", [argv[1], String(depth)], { env: { ...env, LILCHESS_COMPARE_WHICH: w }, encoding: "utf8" }))?.[1]);
  const npm = run("npm");
  const built = run("compiled");
  stdout.write(`compiled / npm speed ratio: ${(built / npm).toFixed(2)} (expect close to 1.0; investigate below about 0.9)\n`);
}
