import { describe, expect, it } from "vitest";
import { engineOnByDefault, type NetEnv } from "./engineDefault";

const desktop: NetEnv = { hasConnectionApi: true, effectiveType: "4g", coarsePointer: false, narrow: false };

describe("engineOnByDefault", () => {
  it("is on for a normal desktop connection", () => {
    expect(engineOnByDefault(desktop)).toBe(true);
  });
  it("is off when the user asked to save data", () => {
    expect(engineOnByDefault({ ...desktop, saveData: true })).toBe(false);
  });
  it("is off on cellular and on slow connections", () => {
    expect(engineOnByDefault({ ...desktop, type: "cellular" })).toBe(false);
    expect(engineOnByDefault({ ...desktop, effectiveType: "3g" })).toBe(false);
    expect(engineOnByDefault({ ...desktop, effectiveType: "2g" })).toBe(false);
  });
  it("stays on for wifi on a phone when the browser can tell", () => {
    expect(engineOnByDefault({ hasConnectionApi: true, type: "wifi", effectiveType: "4g", coarsePointer: true, narrow: true })).toBe(true);
  });
  it("without the Connection API, a phone-sized touch device is off and a desktop is on", () => {
    expect(engineOnByDefault({ hasConnectionApi: false, coarsePointer: true, narrow: true })).toBe(false);
    expect(engineOnByDefault({ hasConnectionApi: false, coarsePointer: false, narrow: false })).toBe(true);
    expect(engineOnByDefault({ hasConnectionApi: false, coarsePointer: true, narrow: false })).toBe(true); // tablet/laptop touchscreen
  });
});
