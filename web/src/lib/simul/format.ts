export function simulClock(s: { mode: string; initialMs: number | null; incrementMs: number | null; daysPerMove: number | null }): string {
  if (s.mode === "live") return `${(s.initialMs ?? 0) / 60_000}+${(s.incrementMs ?? 0) / 1000}`;
  const d = s.daysPerMove ?? 1;
  return `${d} day${d === 1 ? "" : "s"}/move`;
}