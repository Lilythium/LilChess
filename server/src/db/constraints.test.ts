import { START_FEN } from "@lilchess/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb, openDb } from "./connection.js";

const base = {
  id: "x1", white_id: 1, black_id: 2, mode: "live", initial_ms: 60_000, increment_ms: 0, days_per_move: null,
  status: "started", result: null, termination: null, initial_fen: START_FEN, ply: 0,
  white_ms: 60_000, black_ms: 60_000, turn_started_at: 0, deadline_at: 30_000,
  draw_offered_by: null, takeback_offered_by: null, created_at: 0, ended_at: null,
};

function insert(over: Record<string, unknown> = {}) {
  const row = { ...base, ...over };
  const cols = Object.keys(row);
  getDb()
    .prepare(`INSERT INTO games (${cols.join(",")}) VALUES (${cols.map((c) => "@" + c).join(",")})`)
    .run(row);
}

beforeEach(() => {
  openDb(":memory:");
  getDb().exec(`INSERT INTO users (id, username, password_hash, created_at) VALUES (1,'alice','x',0),(2,'bob','x',0)`);
});
afterEach(() => closeDb());

describe("games CHECK constraints", () => {
  it("accepts a started game and a properly finished one", () => {
    insert();
    insert({ id: "x2", status: "finished", result: "1-0", termination: "checkmate", ended_at: 1 });
  });

  it.each([
    ["finished without a result", { status: "finished", termination: "resignation", ended_at: 1 }],
    ["finished without ended_at", { status: "finished", result: "1-0", termination: "resignation" }],
    ["finished by abort", { status: "finished", result: "1-0", termination: "abort", ended_at: 1 }],
    ["aborted with a result", { status: "aborted", result: "1-0", termination: "abort", ended_at: 1 }],
    ["started with a termination", { termination: "timeout" }],
    ["unknown status", { status: "paused" }],
    ["same player on both sides", { black_id: 1 }],
    ["negative clock", { white_ms: -1 }],
    ["live without an increment", { increment_ms: null }],
    ["correspondence with initial_ms", { mode: "correspondence", days_per_move: 3, increment_ms: null }],
    ["offer pending on an ended game", { status: "finished", result: "1-0", termination: "resignation", ended_at: 1, draw_offered_by: "white" }],
  ])("rejects %s", (_label, over) => {
    expect(() => insert(over)).toThrow(/CHECK constraint failed/);
  });
});

describe("moves CHECK constraints", () => {
  it("rejects ply 0, garbage UCI and empty SAN", () => {
    insert();
    const put = (ply: number, uci: string, san: string) =>
      getDb().prepare(`INSERT INTO moves (game_id, ply, uci, san) VALUES ('x1', ?, ?, ?)`).run(ply, uci, san);
    expect(() => put(0, "e2e4", "e4")).toThrow(/CHECK/);
    expect(() => put(1, "Z9Z9", "e4")).toThrow(/CHECK/);
    expect(() => put(1, "e2e4", "")).toThrow(/CHECK/);
    put(1, "e2e4", "e4");
    put(2, "e7e8q", "e8=Q");
  });
});