import { describe, expect, it } from "vitest";
import { parseCustomClock } from "./timeControl";

describe("parseCustomClock", () => {
  it("converts minutes and seconds to milliseconds", () => {
    expect(parseCustomClock(7, 11)).toEqual({ ok: true, initialMs: 420_000, incrementMs: 11_000 });
    expect(parseCustomClock("90", "0")).toEqual({ ok: true, initialMs: 5_400_000, incrementMs: 0 });
  });

  it("accepts fractional minutes down to 10 seconds", () => {
    expect(parseCustomClock(0.5, 0)).toEqual({ ok: true, initialMs: 30_000, incrementMs: 0 });
    expect(parseCustomClock(1 / 6, 0).ok).toBe(true);
  });

  it("accepts anything under six hours, up to 359 minutes 59 seconds", () => {
    expect(parseCustomClock(359, 180)).toEqual({ ok: true, initialMs: 21_540_000, incrementMs: 180_000 });
    expect(parseCustomClock(359.98, 0).ok).toBe(true);
  });

  it("rejects six hours or more", () => {
    for (const m of [360, 361, 1000]) {
      const r = parseCustomClock(m, 0);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error).toMatch(/under 6 hours/);
    }
  });

  it("rejects a start below 10 seconds, empty or non-numeric input", () => {
    expect(parseCustomClock(0.1, 0).ok).toBe(false);
    expect(parseCustomClock(0, 5).ok).toBe(false);
    expect(parseCustomClock("", 0).ok).toBe(false);
    expect(parseCustomClock("abc", 0).ok).toBe(false);
    expect(parseCustomClock(null, 0).ok).toBe(false);
  });

  it("limits the increment to 0-180 whole seconds", () => {
    expect(parseCustomClock(5, 181).ok).toBe(false);
    expect(parseCustomClock(5, -1).ok).toBe(false);
    expect(parseCustomClock(5, 2.5).ok).toBe(false);
    expect(parseCustomClock(5, 180).ok).toBe(true);
  });
});
