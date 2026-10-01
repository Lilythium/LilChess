import { describe, expect, it } from "vitest";
import { ChallengeBody, ClientMessageSchema, MoveBody, RegisterBody } from "./validation.js";

describe("RegisterBody", () => {
  it("accepts a normal signup", () => {
    expect(RegisterBody.safeParse({ username: "alice_1", password: "hunter22!" }).success).toBe(true);
  });
  it("rejects bad usernames and short passwords", () => {
    expect(RegisterBody.safeParse({ username: "a", password: "hunter22!" }).success).toBe(false);
    expect(RegisterBody.safeParse({ username: "bob smith", password: "hunter22!" }).success).toBe(false);
    expect(RegisterBody.safeParse({ username: "bob", password: "short" }).success).toBe(false);
  });
  it("rejects non-string input", () => {
    expect(RegisterBody.safeParse({ username: 5, password: {} }).success).toBe(false);
  });
});

describe("ChallengeBody", () => {
  it("accepts live and correspondence challenges", () => {
    expect(ChallengeBody.safeParse({ mode: "live", initialMs: 300_000, incrementMs: 3_000 }).success).toBe(true);
    expect(ChallengeBody.safeParse({ mode: "correspondence", daysPerMove: 3, colorPref: "white" }).success).toBe(true);
  });
  it("rejects missing or absurd clocks", () => {
    expect(ChallengeBody.safeParse({ mode: "live" }).success).toBe(false);
    expect(ChallengeBody.safeParse({ mode: "live", initialMs: 1 }).success).toBe(false);
    expect(ChallengeBody.safeParse({ mode: "correspondence", daysPerMove: 0 }).success).toBe(false);
    expect(ChallengeBody.safeParse({ mode: "blitz" }).success).toBe(false);
  });
});

describe("move validation", () => {
  it("accepts UCI incl. promotion", () => {
    expect(MoveBody.safeParse({ ply: 0, uci: "e2e4" }).success).toBe(true);
    expect(MoveBody.safeParse({ ply: 10, uci: "e7e8q" }).success).toBe(true);
  });
  it("rejects garbage", () => {
    expect(MoveBody.safeParse({ ply: 0, uci: 5 }).success).toBe(false);
    expect(MoveBody.safeParse({ ply: -1, uci: "e2e4" }).success).toBe(false);
    expect(MoveBody.safeParse({ ply: 1.5, uci: "e2e4" }).success).toBe(false);
    expect(ClientMessageSchema.safeParse({ type: "move", ply: 0, uci: "Z9Z9" }).success).toBe(false);
    expect(ClientMessageSchema.safeParse({ type: "nope" }).success).toBe(false);
  });
});