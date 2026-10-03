import { describe, expect, it } from "vitest";
import { displayName } from "./format";

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