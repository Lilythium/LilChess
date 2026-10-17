import { describe, expect, it } from "vitest";
import { KEYBOARD_MIN_PX, keyboardInset, nextBaseline } from "./keyboard";

describe("nextBaseline", () => {
  it("starts from the first measurement", () => {
    expect(nextBaseline(null, 390, 844)).toEqual({ width: 390, height: 844 });
  });

  it("keeps the tallest height seen at the same width", () => {
    const tall = nextBaseline(null, 390, 844);
    expect(nextBaseline(tall, 390, 520)).toEqual({ width: 390, height: 844 });
    expect(nextBaseline(tall, 390, 860)).toEqual({ width: 390, height: 860 });
  });

  it("starts over when the width changes (rotation)", () => {
    const portrait = nextBaseline(null, 390, 844);
    expect(nextBaseline(portrait, 844, 390)).toEqual({ width: 844, height: 390 });
  });
});

describe("keyboardInset", () => {
  it("is zero while no text field has focus, whatever the height does", () => {
    expect(keyboardInset(844, 500, false)).toBe(0);
  });

  it("reports the lost height once a text field has focus", () => {
    expect(keyboardInset(844, 520, true)).toBe(324);
  });

  it("ignores small drops such as a collapsing URL bar", () => {
    expect(keyboardInset(844, 844 - (KEYBOARD_MIN_PX - 1), true)).toBe(0);
    expect(keyboardInset(844, 844 - KEYBOARD_MIN_PX, true)).toBe(KEYBOARD_MIN_PX);
  });

  it("is zero when the viewport grew back", () => {
    expect(keyboardInset(844, 844, true)).toBe(0);
  });
});
