/**
 * Wraps `fn` so it runs at most once per `intervalMs`. The first call runs immediately; calls inside the interval are
 * dropped, not queued, because every caller here only needs "re-check the server soon", not one re-check per event.
 */
export function throttled(fn: () => void, intervalMs: number, now: () => number = Date.now): () => void {
  let last = Number.NEGATIVE_INFINITY;
  return () => {
    const t = now();
    if (t - last < intervalMs) return;
    last = t;
    fn();
  };
}
