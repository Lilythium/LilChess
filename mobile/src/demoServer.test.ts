import { describe, expect, it } from "vitest";
import { resolveDemoServer } from "./demoServer.js";

describe("resolveDemoServer", () => {
  it("is off unless a usable HTTPS address is configured", () => {
    expect(resolveDemoServer(undefined)).toBeNull();
    expect(resolveDemoServer("   ")).toBeNull();
    expect(resolveDemoServer("http://demo.example.com")).toBeNull();
    expect(resolveDemoServer("ftp://demo.example.com")).toBeNull();
    expect(resolveDemoServer("https://user:pw@demo.example.com")).toBeNull();
    expect(resolveDemoServer("https://demo.example.com/some/path")).toBeNull();
  });

  it("normalizes a bare hostname to its HTTPS origin", () => {
    expect(resolveDemoServer(" demo.example.com ")?.serverUrl).toBe("https://demo.example.com");
    expect(resolveDemoServer("https://demo.example.com:8443")?.wsBaseUrl).toBe("wss://demo.example.com:8443");
  });
});
