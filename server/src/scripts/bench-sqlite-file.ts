
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeUci, squareRank } from "chessops/util";
import { createGame, replay, type GameState } from "@lilchess/shared";
import { closeDb, getDb, openDb } from "../db/connection.js";
import {
  applyMoveAndPersist,
  getGame,
  getMoveSans,
  insertGame,
} from "../db/repositories/games.js";

const GAMES = 20;
const WARMUP = 2;
const CONCURRENCY = 4;
const TARGET_PLIES = 300;
const STRESS_GAMES = 100;
const STRESS_PLIES = 200;

function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomLegalUci(game: GameState, random: () => number) {
  const result = replay(game);
  if (!result.ok) throw new Error(result.error);

  const moves: string[] = [];
  for (const [from, destinations] of result.position.allDests()) {
    const pawn = result.position.board.get(from)?.role === "pawn";
    for (const to of destinations) {
      const lastRank = squareRank(to) === 0 || squareRank(to) === 7;
      moves.push(makeUci({
        from,
        to,
        promotion: pawn && lastRank ? "queen" : undefined,
      }));
    }
  }
  return moves.length ? moves[Math.floor(random() * moves.length)]! : null;
}

function percentile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length
    ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!
    : 0;
}

function memory() {
  const m = process.memoryUsage();
  return {
    rss: m.rss / 1048576,
    heap: m.heapUsed / 1048576,
  };
}

async function playGame(seed: number, maxPlies: number) {
  const id = `bench_${seed}`;
  const random = rng(seed);
  let state = createGame({
    clock: {
      mode: "live",
      initialMs: 3 * 3_600_000,
      incrementMs: 0,
    },
    now: Date.now(),
  });

  insertGame(id, 1, 2, state);
  const samples: { ply: number; move: number; load: number }[] = [];

  while (state.status === "started" && state.ply < maxPlies) {
    const uci = randomLegalUci(state, random);
    if (!uci) break;

    const startMove = performance.now();
    const result = applyMoveAndPersist(id, uci, Date.now());
    const move = performance.now() - startMove;
    if (!result.ok) throw new Error(result.error);

    const startLoad = performance.now();
    state = getGame(id)!;
    getMoveSans(id);
    const load = performance.now() - startLoad;

    samples.push({ ply: state.ply, move, load });
  }

  return samples;
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), "lilchess-sqlite-bench-"));

  try {
    openDb(join(dir, "bench.sqlite"));

    const db = getDb();
    db.exec(`
      INSERT INTO users (id, username, password_hash, created_at)
      VALUES (1, 'bench_a', 'x', 0), (2, 'bench_b', 'x', 0)
    `);

    const journal = db.pragma("journal_mode", { simple: true });
    const synchronous = db.pragma("synchronous", { simple: true });
    const mmap = db.pragma("mmap_size", { simple: true });

    console.log("=== LilChess File-backed SQLite Benchmark ===");
    console.log("Effective settings:", {
      journal_mode: journal,
      synchronous,
      mmap_size: mmap,
    });

    if (String(journal).toLowerCase() !== "wal") {
      throw new Error(`Expected WAL mode, got ${journal}`);
    }

    console.log(`\nWarm-up: ${WARMUP} games`);
    for (let i = 1; i <= WARMUP; i++) {
      await playGame(10000 + i, TARGET_PLIES);
    }

    if (global.gc) global.gc();

    console.log(`Performance run: ${GAMES} games, concurrency ${CONCURRENCY}`);
    const all: { ply: number; move: number; load: number }[] = [];
    const start = performance.now();

    for (let i = 0; i < GAMES; i += CONCURRENCY) {
      const batch = Array.from(
        { length: Math.min(CONCURRENCY, GAMES - i) },
        (_, j) => i + j + 1,
      );
      const results = await Promise.all(
        batch.map((seed) => playGame(seed, TARGET_PLIES)),
      );
      all.push(...results.flat());
    }

    console.log(`Performance duration: ${((performance.now() - start) / 1000).toFixed(2)}s`);

    console.table(
      [
        ["1-50", 1, 50],
        ["51-100", 51, 100],
        ["101-200", 101, 200],
        ["201-300", 201, 300],
      ].map(([label, low, high]) => {
        const rows = all.filter(
          (s) => s.ply >= Number(low) && s.ply <= Number(high),
        );
        const moves = rows.map((s) => s.move);
        const loads = rows.map((s) => s.load);

        return {
          plies: label,
          samples: rows.length,
          "move p50 ms": +percentile(moves, 0.50).toFixed(3),
          "move p95 ms": +percentile(moves, 0.95).toFixed(3),
          "move p99 ms": +percentile(moves, 0.99).toFixed(3),
          "load p50 ms": +percentile(loads, 0.50).toFixed(3),
          "load p95 ms": +percentile(loads, 0.95).toFixed(3),
          "load p99 ms": +percentile(loads, 0.99).toFixed(3),
        };
      }),
    );

    if (global.gc) global.gc();
    const idle = memory();
    let peakRss = idle.rss;
    let peakHeap = idle.heap;

    console.log("\nFile-backed stress test");
    console.log(`Idle RSS: ${idle.rss.toFixed(2)} MB`);
    console.log(`Idle heap: ${idle.heap.toFixed(2)} MB`);

    const stressStart = performance.now();
    const batchSize = 10;

    for (let i = 0; i < STRESS_GAMES; i += batchSize) {
      const batch = Array.from(
        { length: Math.min(batchSize, STRESS_GAMES - i) },
        (_, j) => 50000 + i + j + 1,
      );

      await Promise.all(
        batch.map((seed) => playGame(seed, STRESS_PLIES)),
      );

      const current = memory();
      peakRss = Math.max(peakRss, current.rss);
      peakHeap = Math.max(peakHeap, current.heap);
    }

    console.log(`Stress duration: ${((performance.now() - stressStart) / 1000).toFixed(2)}s`);
    console.log(`Peak RSS: ${peakRss.toFixed(2)} MB`);
    console.log(`Peak heap: ${peakHeap.toFixed(2)} MB`);
    console.log(`RSS growth: +${(peakRss - idle.rss).toFixed(2)} MB`);
    console.log(`Heap growth: +${(peakHeap - idle.heap).toFixed(2)} MB`);
    console.log("Note: memory peaks are sampled after each batch.");
  } finally {
    closeDb();
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  closeDb();
  process.exitCode = 1;
});
