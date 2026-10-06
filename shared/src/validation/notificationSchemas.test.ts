import { describe, expect, it } from "vitest";
import { Email, NotificationSettingsBody, ResetPasswordBody } from "./schemas.js";

describe("Email", () => {
  it("trims and lowercases", () => {
    expect(Email.parse("  Alice@Example.COM ")).toBe("alice@example.com");
  });
  it.each(["alice", "a@", "@b.co", "a b@c.de", ""])("rejects %j", (v) => {
    expect(Email.safeParse(v).success).toBe(false);
  });
});

describe("NotificationSettingsBody", () => {
  it("accepts an empty body, a cleared email and a partial prefs update", () => {
    expect(NotificationSettingsBody.safeParse({}).success).toBe(true);
    expect(NotificationSettingsBody.safeParse({ email: "" }).success).toBe(true);
    expect(NotificationSettingsBody.safeParse({ email: null }).success).toBe(true);
    expect(NotificationSettingsBody.safeParse({ prefs: { your_turn: false } }).success).toBe(true);
  });
  it("rejects bad emails, unknown kinds and non-boolean values", () => {
    expect(NotificationSettingsBody.safeParse({ email: "nope" }).success).toBe(false);
    expect(NotificationSettingsBody.safeParse({ prefs: { spam: true } }).success).toBe(false);
    expect(NotificationSettingsBody.safeParse({ prefs: { your_turn: "no" } }).success).toBe(false);
  });
});

describe("ResetPasswordBody", () => {
  const token = "a".repeat(64);
  it("needs a well-formed token and a valid password", () => {
    expect(ResetPasswordBody.safeParse({ token, password: "hunter22!" }).success).toBe(true);
    expect(ResetPasswordBody.safeParse({ token: "short", password: "hunter22!" }).success).toBe(false);
    expect(ResetPasswordBody.safeParse({ token, password: "short" }).success).toBe(false);
  });
});