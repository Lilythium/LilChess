import { describe, expect, it } from "vitest";
import { displayName, gameTitle } from "./format";

describe("displayName", () => {
  it("capitalises only the first letter", () => {
    expect(displayName("alice")).toBe("Alice");
    expect(displayName("bob_smith")).toBe("Bob_smith");
  });
  it("copes with empty and non-letter starts", () => {
    expect(displayName("")).toBe("");
    expect(displayName("_x")).toBe("_x");
    expect(displayName("9lives")).toBe("9lives");
  });
});

describe("gameTitle", () => {
  it("shows minutes+increment for live, mode for correspondence, variant suffix", () => {
    expect(gameTitle({ mode: "live", initialMs: 300000, incrementMs: 3000 }, "standard")).toBe("5+3");
    expect(gameTitle({ mode: "correspondence" }, "standard")).toBe("correspondence");
    expect(gameTitle({ mode: "live", initialMs: 60000, incrementMs: 0 }, "chess960")).toBe("1+0 · Chess960");
  });
});