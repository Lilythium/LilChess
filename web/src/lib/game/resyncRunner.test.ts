import { describe, expect, it, vi } from "vitest";
import { createResyncRunner, MAX_DISCARDS } from "./resyncRunner";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("createResyncRunner", () => {
  it("fetches once and applies the result", async () => {
    const apply = vi.fn();
    const runner = createResyncRunner(async () => "state", apply, vi.fn());
    await runner.run();
    expect(apply).toHaveBeenCalledExactlyOnceWith("state");
    expect(runner.inFlight()).toBe(false);
  });

  it("shares one request between simultaneous callers, then refreshes once, and never applies the older answer", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const fetchState = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const apply = vi.fn();
    const runner = createResyncRunner(fetchState, apply, vi.fn());

    const a = runner.run();
    const b = runner.run(); // reconnect and foreground at the same moment
    expect(fetchState).toHaveBeenCalledTimes(1);

    first.resolve("stale");
    await Promise.resolve(); await Promise.resolve();
    expect(fetchState).toHaveBeenCalledTimes(2);
    expect(apply).not.toHaveBeenCalled();

    second.resolve("fresh");
    await Promise.all([a, b]);
    expect(apply).toHaveBeenCalledExactlyOnceWith("fresh");
  });

  it("refetches when local state changed mid-flight (a move event arrived)", async () => {
    const first = deferred<string>();
    const fetchState = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce("fresh");
    const apply = vi.fn();
    const runner = createResyncRunner(fetchState, apply, vi.fn());

    const done = runner.run();
    runner.markDirty();
    first.resolve("predates the move");
    await done;

    expect(fetchState).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenCalledExactlyOnceWith("fresh");
  });

  it("ignores markDirty when nothing is in flight", async () => {
    const fetchState = vi.fn().mockResolvedValue("state");
    const runner = createResyncRunner(fetchState, vi.fn(), vi.fn());
    runner.markDirty();
    await runner.run();
    expect(fetchState).toHaveBeenCalledTimes(1);
  });

  it("applies the latest answer after MAX_DISCARDS so a busy game cannot starve the resync", async () => {
    let calls = 0;
    const runner: ReturnType<typeof createResyncRunner<number>> = createResyncRunner(
      async () => { calls += 1; await Promise.resolve(); runner.markDirty(); return calls; },
      (n) => applied.push(n),
      vi.fn(),
    );
    const applied: number[] = [];
    await runner.run();
    expect(calls).toBe(MAX_DISCARDS + 1);
    expect(applied).toEqual([MAX_DISCARDS + 1]);
  });

  it("reports a failure once, and can run again afterwards", async () => {
    const onError = vi.fn();
    const apply = vi.fn();
    const fetchState = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce("back");
    const runner = createResyncRunner(fetchState, apply, onError);

    await runner.run();
    expect(onError).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: "offline" }));
    expect(apply).not.toHaveBeenCalled();

    await runner.run();
    expect(apply).toHaveBeenCalledExactlyOnceWith("back");
  });

  it("retries a failure that happened while state was changing instead of reporting it", async () => {
    const first = deferred<string>();
    const fetchState = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce("fresh");
    const onError = vi.fn();
    const apply = vi.fn();
    const runner = createResyncRunner(fetchState, apply, onError);

    const done = runner.run();
    runner.markDirty();
    first.reject(new Error("socket reset"));
    await done;

    expect(onError).not.toHaveBeenCalled();
    expect(apply).toHaveBeenCalledExactlyOnceWith("fresh");
  });
});
