import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("applies defaults", () => {
    const c = loadConfig({});
    expect(c.port).toBe(3000);
    expect(c.registration).toBe("open");
    expect(c.backupDir).toBe("./data/backups");
    expect(c.trustProxy).toBe(false);
  });

  it("treats empty strings as unset", () => {
    const c = loadConfig({ INVITE_CODE: "", BASE_URL: "", PORT: "" });
    expect(c.port).toBe(3000);
    expect(c.baseOrigin).toBeUndefined();
  });

  it("requires INVITE_CODE in invite mode", () => {
    expect(() => loadConfig({ REGISTRATION: "invite" })).toThrow(/INVITE_CODE/);
    expect(loadConfig({ REGISTRATION: "invite", INVITE_CODE: "abc12345" }).inviteCode).toBe("abc12345");
  });

  it("rejects an invalid PORT", () => {
    expect(() => loadConfig({ PORT: "99999" })).toThrow(/PORT/);
  });

  it("derives Secure cookies from BASE_URL, falling back to NODE_ENV", () => {
    expect(loadConfig({ BASE_URL: "https://chess.example.com/" }).cookieSecure).toBe(true);
    expect(loadConfig({ BASE_URL: "http://192.168.1.5:3000", NODE_ENV: "production" }).cookieSecure).toBe(false);
    expect(loadConfig({ NODE_ENV: "production" }).cookieSecure).toBe(true);
  });

  it("parses TRUST_PROXY", () => {
    expect(loadConfig({ TRUST_PROXY: "1" }).trustProxy).toBe(1);
    expect(loadConfig({ TRUST_PROXY: "true" }).trustProxy).toBe(true);
    expect(loadConfig({ TRUST_PROXY: "10.0.0.0/8" }).trustProxy).toBe("10.0.0.0/8");
  });

  it("allows guests by default and can disable them", () => {
    expect(loadConfig({}).allowGuests).toBe(true);
    expect(loadConfig({ ALLOW_GUESTS: "false" }).allowGuests).toBe(false);
  });
});