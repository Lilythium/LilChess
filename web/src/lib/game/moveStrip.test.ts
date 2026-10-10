import { describe, expect, it } from "vitest";
import { stripItems } from "./moveStrip";

describe("stripItems", () => {
  it("numbers White's moves only", () => {
    expect(stripItems({ 1: "e4", 2: "e5", 3: "Nf3" }, 3).map((i) => i.label)).toEqual(["1. e4", "e5", "2. Nf3"]);
  });
  it("skips plies whose SAN hasn't arrived and ignores plies past the game", () => {
    expect(stripItems({ 1: "e4", 3: "Nf3" }, 2).map((i) => i.ply)).toEqual([1]);
  });
  it("is empty at the start position", () => {
    expect(stripItems({}, 0)).toEqual([]);
  });
});