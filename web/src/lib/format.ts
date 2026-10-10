import { VARIANT_LABELS, type GameState, type Variant } from "@lilchess/shared";

type TC = {
  mode: string; initial_ms: number | null; increment_ms: number | null;
  days_per_move: number | null; variant?: string;
};

export function timeControl(t: TC): string {
  const base = t.mode === "live"
    ? `${(t.initial_ms ?? 0) / 60_000}+${(t.increment_ms ?? 0) / 1000}`
    : `${t.days_per_move} day${t.days_per_move === 1 ? "" : "s"}`;
  return t.variant && t.variant !== "standard" ? `${base} · ${VARIANT_LABELS[t.variant as Variant]}` : base;
}

export function formatDuration(ms: number): string {
  if (ms <= 0) return "0m";
  const m = Math.floor(ms / 60_000), h = Math.floor(m / 60), d = Math.floor(h / 24);
  return d > 0 ? `${d}d ${h % 24}h` : h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
}

export function resultText(g: GameState): string {
  if (g.status === "aborted") return "Game aborted";
  const how = (g.termination ?? "").replace(/_/g, " ");
  const winner = g.result === "1-0" ? "White" : g.result === "0-1" ? "Black" : null;
  return winner ? `${winner} wins by ${how}` : `Draw by ${how}`;
}

export function displayName(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function gameTitle(
  clock: { mode: string; initialMs?: number; incrementMs?: number },
  variant: Variant,
): string {
  const base = clock.mode === "live" && clock.initialMs !== undefined && clock.incrementMs !== undefined
    ? `${Math.floor(clock.initialMs / 60000)}+${Math.floor(clock.incrementMs / 1000)}`
    : clock.mode;
  return variant === "standard" ? base : `${base} · ${VARIANT_LABELS[variant]}`;
}