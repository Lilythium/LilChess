import { makeUci, squareRank } from "chessops/util";
import { createGame, replay, type GameState } from "@lilchess/shared";
import { closeDb, getDb, openDb } from "../db/connection.js";
import { applyMoveAndPersist, getGame, getMoveSans, insertGame } from "../db/repositories/games.js";

function getMemoryMB() {
  const mem = process.memoryUsage();
  return {
    rssMB: +(mem.rss / 1024 / 1024).toFixed(2),
    heapUsedMB: +(mem.heapUsed / 1024 / 1024).toFixed(2),
    externalMB: +(mem.external / 1024 / 1024).toFixed(2),
  };
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomLegalUci(game: GameState, rnd: () => number): string | null {
  const r = replay(game);
  if (!r.ok) throw new Error(r.error);
  const pos = r.position;
  const all: string[] = [];
  for (const [from, dests] of pos.allDests()) {
    const isPawn = pos.board.get(from)?.role === "pawn";
    for (const to of dests) {
      const lastRank = squareRank(to) === 0 || squareRank(to) === 7;
      all.push(makeUci({ from, to, promotion: isPawn && lastRank ? "queen" : undefined }));
    }
  }
  return all.length ? all[Math.floor(rnd() * all.length)]! : null;
}

async function runConcurrentStress(totalGames: number, maxPlies: number) {
  const seeds = Array.from({ length: totalGames }, (_, i) => i + 1);
  let peakRss = 0;
  let peakHeap = 0;

  const batchSize = 25;
  for (let i = 0; i < seeds.length; i += batchSize) {
    const batch = seeds.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (seed) => {
        const id = `stress_${seed}`;
        const rnd = mulberry32(seed);
        let state = createGame({ clock: { mode: "live", initialMs: 3 * 3_600_000, incrementMs: 0 }, now: Date.now() });
        insertGame(id, 1, 2, state);

        while (state.status === "started" && state.ply < maxPlies) {
          const uci = randomLegalUci(state, rnd);
          if (!uci) break;
          const res = applyMoveAndPersist(id, uci, Date.now());
          if (!res.ok) break;
          state = getGame(id)!;
          getMoveSans(id);
        }
      })
    );

    const current = getMemoryMB();
    if (current.rssMB > peakRss) peakRss = current.rssMB;
    if (current.heapUsedMB > peakHeap) peakHeap = current.heapUsedMB;
  }

  return { peakRss, peakHeap };
}

async function main() {
  console.log("=== LilChess RAM & Stress Profiler ==\n");

  // 1. Measure Idle Memory
  openDb(":memory:");
  getDb().exec(`INSERT INTO users (id, username, password_hash, created_at) VALUES (1,'a','x',0),(2,'b','x',0)`);
  
  if (global.gc) global.gc();
  const idleMem = getMemoryMB();
  
  console.log("--- Idle Memory Footprint ---");
  console.log(`  RSS (Physical RAM): ${idleMem.rssMB} MB`);
  console.log(`  Heap Used:         ${idleMem.heapUsedMB} MB`);
  console.log(`  External (C++):    ${idleMem.externalMB} MB`);
  console.log(`  Status:            ${idleMem.rssMB < 100 ? "✅" : "⚠️"} ${idleMem.rssMB} MB / 100 MB idle goal\n`);

  // 2. Heavy Stress Test (100 simultaneous long games up to 200 plies)
  console.log("Running RAM Stress Test (100 concurrent active games, 200 plies each)...");
  const stressStart = performance.now();
  const { peakRss, peakHeap } = await runConcurrentStress(100, 200);
  const stressDuration = ((performance.now() - stressStart) / 1000).toFixed(2);

  console.log("\n--- Stress Test Results ---");
  console.log(`  Duration:          ${stressDuration}s`);
  console.log(`  Peak RSS:          ${peakRss} MB`);
  console.log(`  Peak Heap Used:    ${peakHeap} MB`);
  console.log(`  Memory Growth:     +${(peakRss - idleMem.rssMB).toFixed(2)} MB under load`);

  closeDb();
}

main().catch((err) => {
  console.error(err);
  closeDb();
  process.exit(1);
});