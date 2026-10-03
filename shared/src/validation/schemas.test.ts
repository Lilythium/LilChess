import { describe, expect, it } from "vitest";
import { GameEventSchema, ServerMessageSchema } from "./eventSchemas.js";
import {
  ChallengeBody, ClientMessageSchema, LoginBody, MoveBody, RegisterBody, describeIssue,
} from "./schemas.js";
import { normalizeUsername } from "./username.js";

describe("normalizeUsername", () => {
  it("folds ASCII only and trims", () => {
    expect(normalizeUsername("  AlIcE_1 ")).toBe("alice_1");
    expect(normalizeUsername("Élodie")).toBe("Élodie");
  });
});

describe("RegisterBody / LoginBody", () => {
  it("normalises usernames", () => {
    expect(RegisterBody.parse({ username: "Alice_1", password: "hunter22!" }).username).toBe("alice_1");
    expect(LoginBody.parse({ username: "ALICE", password: "x" }).username).toBe("alice");
  });

  it("rejects bad input with readable messages", () => {
    expect(RegisterBody.safeParse({ username: "a", password: "hunter22!" }).success).toBe(false);
    expect(RegisterBody.safeParse({ username: "bob smith", password: "hunter22!" }).success).toBe(false);
    expect(RegisterBody.safeParse({ username: 5, password: {} }).success).toBe(false);
    const short = RegisterBody.safeParse({ username: "alice", password: "short" });
    expect(!short.success && describeIssue(short.error)).toBe("password: Password must be at least 8 characters");
    const empty = LoginBody.safeParse({ username: "", password: "x" });
    expect(!empty.success && describeIssue(empty.error)).toBe("username: Enter your username");
  });
});

describe("ChallengeBody", () => {
  it("defaults the increment and lowercases the opponent", () => {
    expect(ChallengeBody.parse({ mode: "live", initialMs: 300_000, toUsername: " BOB " })).toEqual({
      mode: "live", initialMs: 300_000, incrementMs: 0, toUsername: "bob",
    });
  });
  it("rejects missing or absurd clocks", () => {
    expect(ChallengeBody.safeParse({ mode: "live" }).success).toBe(false);
    expect(ChallengeBody.safeParse({ mode: "correspondence", daysPerMove: 0 }).success).toBe(false);
    expect(ChallengeBody.safeParse({ mode: "blitz" }).success).toBe(false);
  });
});

describe("move schemas", () => {
  it("accept UCI incl. promotion and reject garbage", () => {
    expect(MoveBody.safeParse({ ply: 10, uci: "e7e8q" }).success).toBe(true);
    expect(MoveBody.safeParse({ ply: -1, uci: "e2e4" }).success).toBe(false);
    expect(ClientMessageSchema.safeParse({ type: "move", ply: 0, uci: "Z9Z9" }).success).toBe(false);
    expect(ClientMessageSchema.safeParse({ type: "nope" }).success).toBe(false);
  });
});

describe("game event schemas", () => {
  const clocks = { whiteMs: 1, blackMs: 2, deadlineAt: 3 };
  const valid = [
    { type: "move", gameId: "g", ply: 1, uci: "e2e4", san: "e4", turn: "black", ...clocks },
    { type: "clock", gameId: "g", ...clocks },
    { type: "draw_offer", gameId: "g", by: null },
    { type: "takeback_offer", gameId: "g", by: "white" },
    { type: "takeback", gameId: "g", ply: 0, turn: "white", ...clocks },
    { type: "game_over", gameId: "g", status: "aborted", termination: "abort" },
    { type: "game_over", gameId: "g", status: "finished", result: "1/2-1/2", termination: "stalemate" },
  ];
  it.each(valid)("accepts %j", (event) => {
    expect(GameEventSchema.safeParse(event).success).toBe(true);
  });

  it.each([
    ["missing san", { type: "move", gameId: "g", ply: 1, uci: "e2e4", turn: "black", ...clocks }],
    ["bad turn", { type: "move", gameId: "g", ply: 1, uci: "e2e4", san: "e4", turn: "green", ...clocks }],
    ["move ply 0", { type: "move", gameId: "g", ply: 0, uci: "e2e4", san: "e4", turn: "black", ...clocks }],
    ["string ply", { type: "move", gameId: "g", ply: "1", uci: "e2e4", san: "e4", turn: "black", ...clocks }],
    ["bad status", { type: "game_over", gameId: "g", status: "started" }],
    ["unknown type", { type: "chat", gameId: "g" }],
    ["null", null],
    ["a string", "hello"],
  ])("rejects %s", (_label, event) => {
    expect(GameEventSchema.safeParse(event).success).toBe(false);
  });

  it("accepts server error messages only through ServerMessageSchema", () => {
    const err = { type: "error", error: "bad_json" };
    expect(ServerMessageSchema.safeParse(err).success).toBe(true);
    expect(GameEventSchema.safeParse(err).success).toBe(false);
  });
});