import { describe, expect, it } from "vitest";
import { abort, acceptDraw, offerDraw, resign } from "./actions.js";
import { applyMove } from "./applyMove.js";
import { createGame } from "./createGame.js";

const LIVE_CLOCK = { mode: "live" as const, initialMs: 60_000, incrementMs: 0 };

it("resign awards the win to the opponent", () => {
  const game = createGame({ clock: LIVE_CLOCK, now: 0 });
  const res = resign(game, "white");
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(res.state.result).toBe("0-1");
  expect(res.state.termination).toBe("resignation");
});

describe("draw offers", () => {
  it("require the other player to accept", () => {
    const game = createGame({ clock: LIVE_CLOCK, now: 0 });
    const offered = offerDraw(game, "white");
    if (!offered.ok) throw new Error("setup failed");

    expect(acceptDraw(offered.state, "white").ok).toBe(false); // can't accept your own

    const accepted = acceptDraw(offered.state, "black");
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.state.result).toBe("1/2-1/2");
    expect(accepted.state.termination).toBe("agreement");
  });
});

describe("abort", () => {
  it("is allowed before black's first reply", () => {
    const game = createGame({ clock: LIVE_CLOCK, now: 0 });
    const afterWhite = applyMove(game, "e2e4", 1_000);
    if (!afterWhite.ok) throw new Error("setup failed");

    const aborted = abort(afterWhite.state);
    expect(aborted.ok).toBe(true);
    if (!aborted.ok) return;
    expect(aborted.state.status).toBe("aborted");
  });

  it("is refused once both sides have moved", () => {
    const game = createGame({ clock: LIVE_CLOCK, now: 0 });
    const s1 = applyMove(game, "e2e4", 1_000);
    if (!s1.ok) throw new Error("setup failed");
    const s2 = applyMove(s1.state, "e7e5", 2_000);
    if (!s2.ok) throw new Error("setup failed");

    expect(abort(s2.state).ok).toBe(false);
  });
});