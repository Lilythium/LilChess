export interface StripItem { ply: number; san: string; label: string }

/** One entry per half-move; White's moves carry the move number ("12. Nf3"). */
export function stripItems(sanByPly: Record<number, string>, ply: number): StripItem[] {
  const items: StripItem[] = [];
  for (let p = 1; p <= ply; p++) {
    const san = sanByPly[p];
    if (!san) continue;
    items.push({ ply: p, san, label: p % 2 === 1 ? `${(p + 1) / 2}. ${san}` : san });
  }
  return items;
}