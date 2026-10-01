import { describe, expect, it } from "vitest";
import { originAllowed } from "./csrf.js";
import { RateWindow } from "./rateWindow.js";

describe("originAllowed", () => {
  it("allows requests without an Origin (non-browser clients)", () => {
    expect(originAllowed(undefined, "chess.test", undefined)).toBe(true);
  });
  it("with BASE_URL, requires an exact origin match", () => {
    const base = "https://chess.example.com";
    expect(originAllowed("https://chess.example.com", "chess.example.com", base)).toBe(true);
    expect(originAllowed("https://evil.example", "chess.example.com", base)).toBe(false);
    expect(originAllowed("http://chess.example.com", "chess.example.com", base)).toBe(false);
  });
  it("without BASE_URL, requires Origin host == Host header", () => {
    expect(originAllowed("http://localhost:5173", "localhost:5173", undefined)).toBe(true);
    expect(originAllowed("http://evil.example", "localhost:5173", undefined)).toBe(false);
  });
  it("rejects null and malformed origins", () => {
    expect(originAllowed("null", "x", undefined)).toBe(false);
    expect(originAllowed("not a url", "x", undefined)).toBe(false);
  });
});

describe("RateWindow", () => {
  it("allows up to max per window, then blocks, then resets", () => {
    const w = new RateWindow(1_000, 3);
    expect([w.hit("a", 0), w.hit("a", 1), w.hit("a", 2), w.hit("a", 3)]).toEqual([true, true, true, false]);
    expect(w.hit("b", 3)).toBe(true); // separate key
    expect(w.hit("a", 1_001)).toBe(true); // window rolled over
  });
});