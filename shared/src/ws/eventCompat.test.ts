import { describe, expect, it } from "vitest";
import { ServerMessageSchema, SimulEventSchema, UserEventSchema } from "../validation/eventSchemas.js";

// Recorded WebSocket events as the first mobile-compatible servers (API version 1) send them. The web and mobile
// clients share these schemas, so one test covers both. The rules (docs/mobile-compatibility.md):
//   - A newer client must keep accepting every event an older server still sends.
//   - A newer server may add fields and event types; an older client must fail safe, not crash.
// If a test here fails after a schema change, the change broke older servers or older apps. Fix the schema or, for a
// real break, raise the API version as the policy describes. Do not edit the recorded events to make it pass.

const game = {
  move: { type: "move", gameId: "g1", ply: 1, uci: "e2e4", san: "e4", turn: "black", whiteMs: 300000, blackMs: 300000, deadlineAt: 1767225600000 },
  clock: { type: "clock", gameId: "g1", whiteMs: 290000, blackMs: 300000, deadlineAt: 1767225600000 },
  draw_offer: { type: "draw_offer", gameId: "g1", by: "white" },
  draw_offer_withdrawn: { type: "draw_offer", gameId: "g1", by: null },
  takeback_offer: { type: "takeback_offer", gameId: "g1", by: "black" },
  takeback: { type: "takeback", gameId: "g1", ply: 0, turn: "white", whiteMs: 300000, blackMs: 300000, deadlineAt: 1767225600000 },
  game_over: { type: "game_over", gameId: "g1", status: "finished", result: "1-0", termination: "checkmate" },
  game_aborted: { type: "game_over", gameId: "g1", status: "aborted" },
  error: { type: "error", error: "ply_mismatch" },
};

const user = {
  pairing_ready: { type: "pairing_ready", tournamentId: "t1", gameId: "g1", round: 1 },
  simul_invite: { type: "simul_invite", simulId: "s1", name: "Friday simul", hostName: "Host" },
  simul_started: { type: "simul_started", simulId: "s1", gameId: "g1" },
};

const simul = {
  simul_board: {
    type: "simul_board", simulId: "s1", gameId: "g1", ply: 2, turn: "white",
    fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1", lastMove: "e2e4", status: "started",
    whiteMs: 300000, blackMs: 300000, deadlineAt: 1767225600000, drawOfferedBy: null,
  },
  simul_state: { type: "simul_state", simulId: "s1", status: "running" },
  simul_roster: { type: "simul_roster", simulId: "s1" },
};

type Union = { options: ReadonlyArray<{ shape: { type: { value: string } } }> };
const typesOf = (schema: unknown) => (schema as Union).options.map((option) => option.shape.type.value).sort();
const recordedTypes = (events: Record<string, { type: string }>) => [...new Set(Object.values(events).map((e) => e.type))].sort();

describe.each([
  ["game socket", ServerMessageSchema, game],
  ["user socket", UserEventSchema, user],
  ["simul socket", SimulEventSchema, simul],
] as const)("%s events", (_name, schema, events) => {
  it.each(Object.entries(events))("still accepts the recorded %s event", (_label, event) => {
    expect(schema.safeParse(event).success).toBe(true);
  });

  it("has a recording for every event type, so a new type cannot be added without one", () => {
    expect(recordedTypes(events)).toEqual(typesOf(schema));
  });

  it.each(Object.entries(events))("ignores fields a newer server adds to %s", (_label, event) => {
    const parsed = schema.safeParse({ ...event, addedByAFutureServer: { nested: true } });
    expect(parsed.success).toBe(true);
  });

  it("fails safe on an event type it has never heard of", () => {
    const parsed = schema.safeParse({ type: "a_future_event", gameId: "g1" });
    expect(parsed.success).toBe(false);
  });
});
