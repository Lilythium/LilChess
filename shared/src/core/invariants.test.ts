import { makeUci, squareRank } from "chessops/util";
import { describe, expect, it } from "vitest";
import {
  abort, acceptDraw, acceptTakeback, claimTimeout, declineDraw, declineTakeback,
  offerDraw, offerTakeback, resign,
} from "./actions.js";
import { applyMove } from "./applyMove.js";
import { createGame } from "./createGame.js";
import { gameStateProblems } from "./invariants.js";
import { replay } from "./replay.js";
import type { ActionResult, ClockConfig, Color, GameState } from "./types.js";

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

const CLOCKS: ClockConfig[] = [
  { mode: "live", initialMs: 3_600_000, incrementMs: 2_000 },
  { mode: "live", initialMs: 30_000, incrementMs: 0 },
  { mode: "correspondence", daysPerMove: 3 },
];

describe("random games never reach an inconsistent state", () => {
  it.each(Array.from({ length: 40 }, (_, i) => i + 1))("seed %i", (seed) => {
    const rnd = mulberry32(seed);
    let game = createGame({ clock: CLOCKS[seed % CLOCKS.length]!, now: 0 });
    let now = 0;

    for (let step = 0; step < 400 && game.status === "started"; step++) {
      now += 1_000;
      const by: Color = rnd() < 0.5 ? "white" : "black";
      const roll = rnd();
      let res: ActionResult;

      if (roll < 0.05) res = offerDraw(game, by);
      else if (roll < 0.08) res = acceptDraw(game, by);
      else if (roll < 0.1) res = declineDraw(game, by);
      else if (roll < 0.14) res = offerTakeback(game, by);
      else if (roll < 0.17) res = acceptTakeback(game, by, now);
      else if (roll < 0.19) res = declineTakeback(game, by);
      else if (roll < 0.195) res = abort(game);
      else if (roll < 0.2) res = resign(game, by);
      else if (roll < 0.205) res = claimTimeout(game, game.deadlineAt + 1);
      else {
        const uci = randomLegalUci(game, rnd);
        if (uci === null) break;
        res = applyMove(game, uci, now);
      }

      if (res.ok) game = res.state;
      expect(gameStateProblems(game), `seed ${seed}, step ${step}`).toEqual([]);
    }
  });
});