import { makeUci, squareRank } from "chessops/util";
import { createGame, replay, type GameState } from "@lilchess/shared";
import { closeDb, getDb, openDb } from "../db/connection.js";
import { applyMoveAndPersist, getGame, getMoveSans, insertGame } from "../db/repositories/games.js";

const TARGET_PLIES = 300;
const SEEDS = 20;

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
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
}

openDb(":memory:");
getDb().exec(`INSERT INTO users (id, username, password_hash, created_at) VALUES (1,'a','x',0),(2,'b','x',0)`);

const samples: { ply: number; moveMs: number; loadMs: number }[] = [];

for (let seed = 1; seed <= SEEDS; seed++) {
  const id = `bench${seed}`;
  const rnd = mulberry32(seed);
  let state = createGame({ clock: { mode: "live", initialMs: 3 * 3_600_000, incrementMs: 0 }, now: Date.now() });
  insertGame(id, 1, 2, state);

  while (state.status === "started" && state.ply < TARGET_PLIES) {
    const uci = randomLegalUci(state, rnd);
    if (!uci) break;

    const t0 = performance.now();
    const res = applyMoveAndPersist(id, uci, Date.now());
    const moveMs = performance.now() - t0;
    if (!res.ok) throw new Error(`${uci}: ${res.error}`);

    const t1 = performance.now();
    state = getGame(id)!;
    getMoveSans(id);
    samples.push({ ply: state.ply, moveMs, loadMs: performance.now() - t1 });
  }
}

const buckets: [string, number, number][] = [["1-50", 1, 50], ["51-100", 51, 100], ["101-200", 101, 200], ["201-300", 201, 300]];
console.table(
  buckets.map(([label, lo, hi]) => {
    const s = samples.filter((x) => x.ply >= lo && x.ply <= hi);
    const mv = s.map((x) => x.moveMs);
    const ld = s.map((x) => x.loadMs);
    return {
      plies: label,
      samples: s.length,
      "move p50 ms": +pct(mv, 0.5).toFixed(2),
      "move p95 ms": +pct(mv, 0.95).toFixed(2),
      "load p50 ms": +pct(ld, 0.5).toFixed(2),
      "load p95 ms": +pct(ld, 0.95).toFixed(2),
    };
  }),
);
closeDb();