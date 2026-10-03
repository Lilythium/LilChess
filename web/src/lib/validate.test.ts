import { describe, expect, it } from "vitest";
import { LoginBody, RegisterBody } from "@lilchess/shared";
import { validate } from "./validate";

describe("validate", () => {
  it("returns parsed, normalised data", () => {
    const r = validate(RegisterBody, { username: "Alice_1", password: "hunter22!" });
    expect(r).toEqual({ ok: true, data: { username: "alice_1", password: "hunter22!" } });
  });

  it("returns the first issue's message", () => {
    expect(validate(RegisterBody, { username: "a!", password: "hunter22!" })).toEqual({
      ok: false,
      error: "Username must be 3–20 letters, digits, _ or -",
    });
    expect(validate(RegisterBody, { username: "alice", password: "short" })).toEqual({
      ok: false,
      error: "Password must be at least 8 characters",
    });
    expect(validate(LoginBody, { username: "", password: "x" })).toEqual({
      ok: false,
      error: "Enter your username",
    });
  });
});