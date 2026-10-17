import { describe, expect, it } from "vitest";
import { nativeSessionStorageKey } from "./secureSession.js";

describe("native session credential namespace", () => {
  it("normalizes server origins and isolates credentials for different instances", () => {
    expect(nativeSessionStorageKey("https://CHESS.example.com/"))
      .toBe(nativeSessionStorageKey("https://chess.example.com"));
    expect(nativeSessionStorageKey("https://chess.example.com"))
      .not.toBe(nativeSessionStorageKey("https://other.example.com"));
    expect(nativeSessionStorageKey("http://192.168.1.4:3000"))
      .not.toBe(nativeSessionStorageKey("https://192.168.1.4:3000"));
  });
});
