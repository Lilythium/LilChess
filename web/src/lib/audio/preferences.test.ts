import { describe, expect, it } from "vitest";
import { parseSoundPreferences } from "./audio";

describe("parseSoundPreferences", () => {
  it("defaults to sound on at half volume", () => {
    expect(parseSoundPreferences(null)).toEqual({ enabled: true, volume: 0.5 });
    expect(parseSoundPreferences("")).toEqual({ enabled: true, volume: 0.5 });
  });

  it("restores a saved mute and volume", () => {
    expect(parseSoundPreferences(JSON.stringify({ enabled: false, volume: 0.2 }))).toEqual({ enabled: false, volume: 0.2 });
  });

  it("clamps the volume and ignores values of the wrong type", () => {
    expect(parseSoundPreferences(JSON.stringify({ enabled: true, volume: 7 })).volume).toBe(1);
    expect(parseSoundPreferences(JSON.stringify({ enabled: true, volume: -3 })).volume).toBe(0);
    expect(parseSoundPreferences(JSON.stringify({ enabled: "no", volume: "loud" }))).toEqual({ enabled: true, volume: 0.5 });
  });

  it("survives corrupt storage", () => {
    expect(parseSoundPreferences("{not json")).toEqual({ enabled: true, volume: 0.5 });
    expect(parseSoundPreferences("null")).toEqual({ enabled: true, volume: 0.5 });
  });
});
