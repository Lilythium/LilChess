import { describe, expect, it, vi } from "vitest";
import { throttled } from "./throttle";

describe("throttled", () => {
  it("runs the first call immediately and drops calls inside the interval", () => {
    let t = 1_000;
    const fn = vi.fn();
    const run = throttled(fn, 5_000, () => t);

    run();
    t += 4_999;
    run();
    run();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("runs again once the interval has passed", () => {
    let t = 0;
    const fn = vi.fn();
    const run = throttled(fn, 5_000, () => t);

    run();
    t = 5_000;
    run();
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
