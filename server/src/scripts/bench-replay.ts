import { makeUci, squareRank } from "chessops/util";
import { createGame, replay, type GameState } from "@lilchess/shared";
import { closeDb, getDb, openDb } from "../db/connection.js";
import { applyMoveAndPersist, getGame, getMoveSans, insertGame } from "../db/repositories/games.js";

const TARGET_PLIES = 300;
const SEEDS = 20;
const WARMUP_SEEDS = 2;
const CONCURRENCY = 4;

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

function pct(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
}

interface Sample {
  ply: number;
  moveMs: number;
  loadMs: number;
  heapUsedMB: number;
}

async function runGame(seed: number): Promise<{ samples: Sample[]; termination: string }> {
  const id = `bench_s${seed}`;
  const rnd = mulberry32(seed);
  let state = createGame({ clock: { mode: "live", initialMs: 3 * 3_600_000, incrementMs: 0 }, now: Date.now() });
  insertGame(id, 1, 2, state);

  const gameSamples: Sample[] = [];
  let termination = "max_plies";

  while (state.status === "started" && state.ply < TARGET_PLIES) {
    const uci = randomLegalUci(state, rnd);
    if (!uci) {
      termination = "stalemate_or_no_moves";
      break;
    }

    const t0 = performance.now();
    const res = applyMoveAndPersist(id, uci, Date.now());
    const moveMs = performance.now() - t0;
    if (!res.ok) throw new Error(`${uci}: ${res.error}`);

    const t1 = performance.now();
    state = getGame(id)!;
    getMoveSans(id);
    const loadMs = performance.now() - t1;

    const heapUsedMB = +(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
    gameSamples.push({ ply: state.ply, moveMs, loadMs, heapUsedMB });

    if (state.status !== "started") {
      termination = state.status;
      break;
    }
  }

  return { samples: gameSamples, termination };
}

async function main() {
  openDb(":memory:");
  // Insert users to satisfy foreign key constraints
  getDb().exec(`INSERT INTO users (id, username, password_hash, created_at) VALUES (1,'a','x',0),(2,'b','x',0),(3,'c','x',0),(4,'d','x',0)`);

  console.log(`Running warm-up (${WARMUP_SEEDS} games)...`);
  for (let i = 1; i <= WARMUP_SEEDS; i++) {
    await runGame(999 + i);
  }
  global.gc && global.gc();

  console.log(`Running benchmark (${SEEDS} games, concurrency: ${CONCURRENCY})...`);
  const allSamples: Sample[] = [];
  const terminationCounts: Record<string, number> = {};

  const seeds = Array.from({ length: SEEDS }, (_, i) => i + 1);

  for (let i = 0; i < seeds.length; i += CONCURRENCY) {
    const batch = seeds.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((seed) => runGame(seed)));
    for (const r of results) {
      allSamples.push(...r.samples);
      terminationCounts[r.termination] = (terminationCounts[r.termination] || 0) + 1;
    }
  }

  const buckets: [string, number, number][] = [
    ["1-50", 1, 50],
    ["51-100", 51, 100],
    ["101-200", 101, 200],
    ["201-300", 201, 300],
  ];

  console.log("\n--- Performance Benchmark Results ---");
  console.table(
    buckets.map(([label, lo, hi]) => {
      const s = allSamples.filter((x) => x.ply >= lo && x.ply <= hi);
      const mv = s.map((x) => x.moveMs);
      const ld = s.map((x) => x.loadMs);
      const hp = s.map((x) => x.heapUsedMB);
      return {
        plies: label,
        samples: s.length,
        "move p50 ms": +pct(mv, 0.5).toFixed(2),
        "move p95 ms": +pct(mv, 0.95).toFixed(2),
        "move p99 ms": +pct(mv, 0.99).toFixed(2),
        "load p50 ms": +pct(ld, 0.5).toFixed(2),
        "load p95 ms": +pct(ld, 0.95).toFixed(2),
        "load p99 ms": +pct(ld, 0.99).toFixed(2),
        "heap avg MB": +(hp.reduce((a, b) => a + b, 0) / (hp.length || 1)).toFixed(1),
      };
    }),
  );

  console.log("\nGame Termination Breakdown:", terminationCounts);
  closeDb();
}

main().catch((err) => {
  console.error(err);
  closeDb();
  process.exit(1);
});