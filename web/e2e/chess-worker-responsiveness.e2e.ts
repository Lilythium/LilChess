
import { expect, test } from "@playwright/test";

/**
 * Measures real browser main-thread responsiveness with the actual bundled Web Worker.
 * Run with the Vite web app available at BASE_URL (defaults to http://localhost:5173).
 * This is a measurement test, not a pass/fail performance threshold: browser/CPU load varies.
 */
test("measure chess worker main-thread responsiveness", async ({ page }) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const modulePath = "/src/lib/chess/chessWorkerClient.ts";
    const { createChessWorkerClient } = await import(
    /* @vite-ignore */ modulePath
    );

    const START_FEN =
      "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

    // A repeatable legal 4-ply cycle. 1,000 plies is intentionally heavier
    // than normal live-move handling.
    const cycle = ["g1f3", "g8f6", "f3g1", "f6g8"];
    const moves = Array.from(
      { length: 1000 },
      (_, i) => cycle[i % cycle.length]!,
    );

    const intervalMs = 2;
    const repetitions = 6;

    function percentile(values: number[], p: number): number {
      const sorted = [...values].sort((a, b) => a - b);
      return (
        sorted[
          Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))
        ] ?? 0
      );
    }

    async function run(useWorker: boolean) {
      const client = createChessWorkerClient({
        idleMs: 60_000,
        ...(useWorker ? {} : { createWorker: () => null }),
      });

      const taskTimes: number[] = [];
      const timerDelays: number[] = [];
      let timerTicks = 0;
      let timerStart = performance.now();

      const timer = window.setInterval(() => {
        timerTicks += 1;
        const expected = timerStart + timerTicks * intervalMs;
        timerDelays.push(Math.max(0, performance.now() - expected));
      }, intervalMs);

      try {
        // Warm up module loading and the worker before recording samples.
        await client.timeline(START_FEN, "standard", moves.slice(0, 40));

        taskTimes.length = 0;
        timerDelays.length = 0;
        timerTicks = 0;

        // Reset the timer baseline after warm-up.
        timerStart = performance.now();

        await new Promise<void>((resolve) =>
          window.setTimeout(resolve, intervalMs * 2),
        );

        // Exclude the warm-up wait from recorded timer-delay samples.
        timerDelays.length = 0;
        timerTicks = 0;
        timerStart = performance.now();

        const measuredStart = performance.now();

        for (let i = 0; i < repetitions; i += 1) {
          const started = performance.now();
          const timeline = await client.timeline(
            START_FEN,
            "standard",
            moves,
          );

          taskTimes.push(performance.now() - started);

          if (!timeline) {
            throw new Error("Timeline generation failed");
          }
        }

        const elapsedMs = performance.now() - measuredStart;

        return {
          mode: useWorker ? "worker" : "inline-fallback",
          taskMs: {
            p50: percentile(taskTimes, 0.5),
            p95: percentile(taskTimes, 0.95),
            max: Math.max(...taskTimes),
          },
          timerDelayMs: {
            p50: percentile(timerDelays, 0.5),
            p95: percentile(timerDelays, 0.95),
            p99: percentile(timerDelays, 0.99),
            max: Math.max(0, ...timerDelays),
          },
          timerSamples: timerDelays.length,
          elapsedMs,
        };
      } finally {
        window.clearInterval(timer);
        client.dispose();
      }
    }

    // Measure each mode once. Repeat the test itself to check consistency.
    const worker = await run(true);
    const inlineFallback = await run(false);

    return { worker, inlineFallback };
  });

  const samples = [result.worker, result.inlineFallback];

  console.log(
    "\nChess worker responsiveness benchmark (milliseconds; lower is better)",
  );

  console.table(
    samples.map((sample) => ({
      mode: sample.mode,
      task_p50_ms: sample.taskMs.p50.toFixed(2),
      task_p95_ms: sample.taskMs.p95.toFixed(2),
      task_max_ms: sample.taskMs.max.toFixed(2),
      timer_delay_p50_ms: sample.timerDelayMs.p50.toFixed(2),
      timer_delay_p95_ms: sample.timerDelayMs.p95.toFixed(2),
      timer_delay_p99_ms: sample.timerDelayMs.p99.toFixed(2),
      timer_delay_max_ms: sample.timerDelayMs.max.toFixed(2),
      timer_samples: sample.timerSamples,
      total_elapsed_ms: sample.elapsedMs.toFixed(2),
    })),
  );

  expect(result.worker.mode).toBe("worker");
  expect(result.inlineFallback.mode).toBe("inline-fallback");
  expect(result.worker.timerSamples).toBeGreaterThan(0);
  expect(result.inlineFallback.timerSamples).toBeGreaterThan(0);
});
