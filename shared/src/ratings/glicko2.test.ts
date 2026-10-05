import { describe, expect, it } from "vitest";
import { DEFAULT_RATING, MAX_RD, glicko2, idlePeriods, inflateRd, rateGame, RATING_PERIOD_MS } from "./glicko2.js";

describe("glicko2", () => {
  it("reproduces the worked example from Glickman's paper", () => {
    const out = glicko2(
      { rating: 1500, rd: 200, volatility: 0.06 },
      [
        { opponent: { rating: 1400, rd: 30 }, score: 1 },
        { opponent: { rating: 1550, rd: 100 }, score: 0 },
        { opponent: { rating: 1700, rd: 300 }, score: 0 },
      ],
      0.5,
    );
    expect(out.rating).toBeCloseTo(1464.06, 1);
    expect(out.rd).toBeCloseTo(151.52, 1);
    expect(out.volatility).toBeCloseTo(0.05999, 4);
  });

  it("only grows RD when there are no games", () => {
    const out = glicko2({ rating: 1500, rd: 200, volatility: 0.06 }, []);
    expect(out.rating).toBe(1500);
    expect(out.rd).toBeGreaterThan(200);
  });
});

describe("rateGame", () => {
  it("moves a win and a loss symmetrically between equal players", () => {
    const { white, black } = rateGame(DEFAULT_RATING, DEFAULT_RATING, "1-0");
    expect(white.rating).toBeGreaterThan(1500);
    expect(black.rating).toBeLessThan(1500);
    expect(white.rating - 1500).toBeCloseTo(1500 - black.rating, 6);
    expect(white.rd).toBeLessThan(350);
  });

  it("leaves equal players' ratings alone on a draw but shrinks RD", () => {
    const { white, black } = rateGame(DEFAULT_RATING, DEFAULT_RATING, "1/2-1/2");
    expect(white.rating).toBeCloseTo(1500, 6);
    expect(black.rating).toBeCloseTo(1500, 6);
    expect(white.rd).toBeLessThan(350);
  });

  it("moves an uncertain player more than an established one", () => {
    const veteran = { rating: 1500, rd: 60, volatility: 0.06 };
    const { white, black } = rateGame(DEFAULT_RATING, veteran, "1-0");
    expect(white.rating - 1500).toBeGreaterThan(1500 - black.rating);
  });
});

describe("inactivity", () => {
  const r = { rating: 1600, rd: 50, volatility: 0.06 };
  it("leaves RD alone for zero periods and grows it for more", () => {
    expect(inflateRd(r, 0)).toEqual(r);
    expect(inflateRd(r, 10).rd).toBeGreaterThan(50);
    expect(inflateRd(r, 10).rating).toBe(1600);
  });
  it("caps at the maximum RD", () => {
    expect(inflateRd(r, 1_000_000).rd).toBe(MAX_RD);
  });
  it("counts whole periods since the last game", () => {
    expect(idlePeriods(null, 123)).toBe(0);
    expect(idlePeriods(0, RATING_PERIOD_MS - 1)).toBe(0);
    expect(idlePeriods(0, 3 * RATING_PERIOD_MS + 5)).toBe(3);
  });
});