// Measures the main-thread time the client spends on chess work, before and after the worker offload.
//   npm run bench:chess-main-thread
//
// "Before" is what the page used to do on the main thread. "After" is what is left on it: the move-at-a-time board
// positions, and for whole-game work only receiving the worker's answer (structuredClone is the same copy the browser
// makes for postMessage) and wrapping it back into a timeline. Node on a desktop CPU is much faster than a phone, so
// read the numbers as ratios; a phone takes several times longer in absolute terms. One frame at 60 fps is 16.7 ms.
import { Chess } from "chessops/chess";
import { makeUci } from "chessops/util";
import { PositionTimeline, START_FEN, createGame, replay, type GameState } from "@lilchess/shared";
import { createBoardPositions } from "../web/src/lib/game/boardPositions";
import { parseAnalysisInput } from "../web/src/lib/analysis/importText";
import { runChessTask } from "../web/src/lib/chess/chessTasks";

function randomLine(plies: number, seed: number): string[] {
  let s = seed;
  const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  for (;;) {
    const pos = Chess.default();
    const moves: string[] = [];
    while (moves.length < plies && !pos.isEnd()) {
      const all: { from: number; to: number; promotion?: "queen" }[] = [];
      for (const [from, dests] of pos.allDests()) for (const to of dests) all.push({ from, to });
      const m = all[Math.floor(rnd() * all.length)]!;
      if (pos.board.get(m.from)?.role === "pawn" && (m.to < 8 || m.to > 55)) m.promotion = "queen";
      moves.push(makeUci(m));
      pos.play(m);
    }
    if (moves.length >= plies) return moves;
    seed += 1;
    s = seed;
  }
}

function sample(f: () => void, runs: number): { p50: number; max: number } {
  f();
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    f();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return { p50: times[runs >> 1]!, max: times[runs - 1]! };
}

const fmt = (n: number) => n.toFixed(2).padStart(7);
function row(label: string, before: { p50: number; max: number }, after: { p50: number; max: number }) {
  const ratio = after.p50 > 0 ? (before.p50 / after.p50).toFixed(1) : "n/a";
  console.log(`${label.padEnd(46)} before p50 ${fmt(before.p50)} max ${fmt(before.max)}   after p50 ${fmt(after.p50)} max ${fmt(after.max)}   ${ratio}x`);
}

const moves = randomLine(300, 1);
const gameAt = (n: number): GameState => ({
  ...createGame({ clock: { mode: "live", initialMs: 60_000, incrementMs: 0 }, now: 0 }),
  moves: moves.slice(0, n),
  ply: n,
});

console.log("ms of main-thread time (lower is better)\n");

// 1. The live board: positions needed when one more move arrives. Old: replay from move 1. New: one move.
for (const n of [40, 150, 300]) {
  const game = gameAt(n);
  const positions = createBoardPositions();
  positions.at(gameAt(n - 1), n - 1); // the board already showed the previous move
  row(
    `board: next move at ply ${n}`,
    sample(() => { replay(game); }, 40),
    sample(() => {
      // Each run is "the previous position is cached, one move arrives"; rewind the cache by one move first.
      positions.at(gameAt(n - 1), n - 1);
      positions.at(game, n);
    }, 40),
  );
}

// 2. Opening a 300-ply game in analysis. Old: build the timeline on the main thread. New: receive it and wrap it.
{
  const built = (() => { const t = new PositionTimeline(START_FEN); t.sync(moves); return t.snapshot(); })();
  row(
    "analysis: open a 300-ply game",
    sample(() => { new PositionTimeline(START_FEN).sync(moves); }, 40),
    sample(() => { PositionTimeline.restore(START_FEN, "standard", structuredClone(built)); }, 40),
  );
}

// 3. Pasting a PGN: parse + validate + build positions.
function pgnWithGames(count: number): string {
  const t = new PositionTimeline(START_FEN);
  t.sync(moves);
  let one = '[Event "bench"]\n[White "a"]\n[Black "b"]\n[Result "*"]\n\n';
  for (let i = 0; i < t.sans.length; i++) one += (i % 2 === 0 ? `${i / 2 + 1}. ` : "") + t.sans[i] + " ";
  one += "*\n";
  return Array.from({ length: count }, () => one).join("\n\n");
}
for (const count of [1, 60]) {
  const text = pgnWithGames(count);
  const answer = runChessTask({ op: "parseInput", text });
  row(
    `paste: PGN, ${count} game(s), ${(text.length / 1000).toFixed(0)} KB`,
    sample(() => {
      const parsed = parseAnalysisInput(text);
      if (parsed.ok) new PositionTimeline(parsed.game.initialFen, parsed.game.variant).sync(parsed.game.moves);
    }, count === 1 ? 40 : 10),
    sample(() => {
      const copy = structuredClone(answer);
      if (copy.timeline && copy.parsed.ok) PositionTimeline.restore(copy.parsed.game.initialFen, copy.parsed.game.variant, copy.timeline);
    }, count === 1 ? 40 : 10),
  );
}
