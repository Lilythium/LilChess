
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
    function makePgn(plies: number): string {
      return [
        '[Event "Responsiveness benchmark"]',
        "",
        ...Array.from(
          { length: plies / 4 },
          (_, i) => `${i * 2 + 1}. Nf3 Nf6 ${i * 2 + 2}. Ng1 Ng8`,
        ),
        "*",
      ].join("\n");
    }

    const pgn = makePgn(moves.length);

    const intervalMs = 2;
    const rounds = 6;

    function percentile(values: number[], p: number): number {
      const sorted = [...values].sort((a, b) => a - b);
      return (
        sorted[
          Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))
        ] ?? 0
      );
    }

    const workflows = [
      {
        name: "large-pgn-import",
        warmup: (client: ReturnType<typeof createChessWorkerClient>) =>
          client.parseInput(makePgn(40)),
        execute: async (client: ReturnType<typeof createChessWorkerClient>) => {
          const result = await client.parseInput(pgn);
          if (!result.parsed.ok || !result.timeline) {
            throw new Error("Large PGN import failed");
          }
          return result;
        },
      },
      {
        name: "long-game-analysis",
        warmup: (client: ReturnType<typeof createChessWorkerClient>) =>
          client.timeline(START_FEN, "standard", moves.slice(0, 40)),
        execute: async (client: ReturnType<typeof createChessWorkerClient>) => {
          const timeline = await client.timeline(START_FEN, "standard", moves);
          if (!timeline) throw new Error("Long-game analysis failed");
          return timeline;
        },
      },
    ];

    async function runSample(
      useWorker: boolean,
      workflow: (typeof workflows)[number],
    ) {
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
        await workflow.warmup(client);

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
        const started = performance.now();
        const result = await workflow.execute(client);
        taskTimes.push(performance.now() - started);
        if (!result) throw new Error(`${workflow.name} failed`);

        const elapsedMs = performance.now() - measuredStart;
        await new Promise<void>((resolve) =>
          window.setTimeout(resolve, intervalMs * 2),
        );

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
          taskMsValues: taskTimes,
          timerDelayValues: timerDelays,
        };
      } finally {
        window.clearInterval(timer);
        client.dispose();
      }
    }

    async function runWorkflow(workflow: (typeof workflows)[number]) {
      const samples: Record<string, Awaited<ReturnType<typeof runSample>>[]> = {
        worker: [],
        "inline-fallback": [],
      };

      for (let round = 0; round < rounds; round += 1) {
        const order = round % 2 === 0 ? [true, false] : [false, true];
        for (const useWorker of order) {
          const sample = await runSample(useWorker, workflow);
          samples[sample.mode]!.push(sample);
        }
      }

      return Object.entries(samples).map(([mode, modeSamples]) => {
        const taskTimes = modeSamples.flatMap((sample) => sample.taskMsValues);
        const timerDelays = modeSamples.flatMap((sample) => sample.timerDelayValues);
        return {
          workflow: workflow.name,
          mode,
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
          elapsedMs: modeSamples.reduce((total, sample) => total + sample.elapsedMs, 0),
        };
      });
    }

    const results = [];
    for (const workflow of workflows) {
      results.push(...(await runWorkflow(workflow)));
    }

    return results;
  });

  console.log(
    "\nChess worker responsiveness benchmark (milliseconds; lower is better)",
  );

  console.table(
    result.map((sample) => ({
      workflow: sample.workflow,
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

  expect(result).toHaveLength(4);
  expect(result.map((sample) => `${sample.workflow}:${sample.mode}`).sort()).toEqual([
    "large-pgn-import:inline-fallback",
    "large-pgn-import:worker",
    "long-game-analysis:inline-fallback",
    "long-game-analysis:worker",
  ]);
  expect(result.every((sample) => sample.timerSamples > 0)).toBe(true);
});
