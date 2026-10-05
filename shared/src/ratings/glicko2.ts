import type { GameResult } from "../core/types.js";

// Glickman's Glicko-2 (http://www.glicko.net/glicko/glicko2.pdf).

export interface Rating {
  rating: number;
  rd: number;
  volatility: number;
}

export interface GameOutcome {
  opponent: Pick<Rating, "rating" | "rd">;
  score: number; // 1 win, 0.5 draw, 0 loss
}

/** What the UI shows: rounded rating plus "?" when provisional. */
export interface RatingBadge {
  rating: number;
  provisional: boolean;
}

export const DEFAULT_RATING: Rating = { rating: 1500, rd: 350, volatility: 0.06 };
export const TAU = 0.5;
export const MIN_RATING = 100;
export const MIN_RD = 45;
export const MAX_RD = 350;
export const PROVISIONAL_RD = 110;
export const RATING_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

const SCALE = 173.7178;
const EPSILON = 1e-6;

const g = (phi: number) => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
const expected = (mu: number, muJ: number, phiJ: number) => 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));

/** One rating period for one player. With no results only the RD grows. */
export function glicko2(player: Rating, results: GameOutcome[], tau = TAU): Rating {
  const mu = (player.rating - 1500) / SCALE;
  const phi = player.rd / SCALE;
  const sigma = player.volatility;

  if (results.length === 0) {
    return { rating: player.rating, rd: Math.sqrt(phi * phi + sigma * sigma) * SCALE, volatility: sigma };
  }

  let vInv = 0;
  let deltaSum = 0;
  for (const r of results) {
    const muJ = (r.opponent.rating - 1500) / SCALE;
    const phiJ = r.opponent.rd / SCALE;
    const gj = g(phiJ);
    const e = expected(mu, muJ, phiJ);
    vInv += gj * gj * e * (1 - e);
    deltaSum += gj * (r.score - e);
  }
  const v = 1 / vInv;
  const delta = v * deltaSum;

  // New volatility (Illinois algorithm, step 5)
  const a = Math.log(sigma * sigma);
  const phi2 = phi * phi;
  const f = (x: number) => {
    const ex = Math.exp(x);
    return (ex * (delta * delta - phi2 - v - ex)) / (2 * (phi2 + v + ex) ** 2) - (x - a) / (tau * tau);
  };

  let A = a;
  let B: number;
  if (delta * delta > phi2 + v) {
    B = Math.log(delta * delta - phi2 - v);
  } else {
    let k = 1;
    while (k < 1000 && f(a - k * tau) < 0) k++;
    B = a - k * tau;
  }
  let fA = f(A);
  let fB = f(B);
  for (let i = 0; i < 100 && Math.abs(B - A) > EPSILON; i++) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA /= 2;
    }
    B = C;
    fB = fC;
  }
  const newSigma = Math.exp(A / 2);

  const phiStar = Math.sqrt(phi2 + newSigma * newSigma);
  const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const newMu = mu + newPhi * newPhi * deltaSum;

  return { rating: newMu * SCALE + 1500, rd: newPhi * SCALE, volatility: newSigma };
}

/** RD growth over `periods` idle rating periods: phi' = sqrt(phi^2 + t * sigma^2). */
export function inflateRd(r: Rating, periods: number): Rating {
  if (periods <= 0) return r;
  const phi = r.rd / SCALE;
  const rd = Math.sqrt(phi * phi + periods * r.volatility * r.volatility) * SCALE;
  return { ...r, rd: Math.min(MAX_RD, rd) };
}

export function idlePeriods(lastGameAt: number | null, now: number): number {
  if (lastGameAt === null) return 0;
  return Math.max(0, Math.floor((now - lastGameAt) / RATING_PERIOD_MS));
}

export const isProvisional = (rd: number) => rd > PROVISIONAL_RD;

const clamp = (r: Rating): Rating => ({
  rating: Math.max(MIN_RATING, r.rating),
  rd: Math.min(MAX_RD, Math.max(MIN_RD, r.rd)),
  volatility: r.volatility,
});

/** Both players are updated from their pre-game ratings (simultaneously). */
export function rateGame(white: Rating, black: Rating, result: GameResult): { white: Rating; black: Rating } {
  const ws = result === "1-0" ? 1 : result === "0-1" ? 0 : 0.5;
  return {
    white: clamp(glicko2(white, [{ opponent: black, score: ws }])),
    black: clamp(glicko2(black, [{ opponent: white, score: 1 - ws }])),
  };
}