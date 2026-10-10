import { z } from "zod";
import type { GameEvent, SimulEvent, UserEvent } from "../ws/events.js";

const Color = z.enum(["white", "black"]);
const GameResult = z.enum(["1-0", "0-1", "1/2-1/2"]);
const Termination = z.enum([
  "checkmate", "stalemate", "insufficient_material", "fifty_move", "repetition",
  "resignation", "agreement", "timeout", "abort",
]);

const gameId = z.string();
const ms = z.number();

const MoveEvent = z.object({
  type: z.literal("move"), gameId, ply: z.number().int().min(1), uci: z.string(), san: z.string(),
  turn: Color, whiteMs: ms, blackMs: ms, deadlineAt: ms,
});
const ClockEvent = z.object({ type: z.literal("clock"), gameId, whiteMs: ms, blackMs: ms, deadlineAt: ms });
const DrawOfferEvent = z.object({ type: z.literal("draw_offer"), gameId, by: Color.nullable() });
const TakebackOfferEvent = z.object({ type: z.literal("takeback_offer"), gameId, by: Color.nullable() });
const TakebackEvent = z.object({
  type: z.literal("takeback"), gameId, ply: z.number().int().min(0),
  turn: Color, whiteMs: ms, blackMs: ms, deadlineAt: ms,
});
const GameOverEvent = z.object({
  type: z.literal("game_over"), gameId, status: z.enum(["finished", "aborted"]),
  result: GameResult.optional(), termination: Termination.optional(),
});

// Sent only to the socket that caused it (bad_json, ply_mismatch, ...).
const ServerErrorMessage = z.object({ type: z.literal("error"), error: z.string() });

export const GameEventSchema = z.discriminatedUnion("type", [
  MoveEvent, ClockEvent, DrawOfferEvent, TakebackOfferEvent, TakebackEvent, GameOverEvent,
]);

// Everything the server can put on a game socket.
export const ServerMessageSchema = z.discriminatedUnion("type", [
  MoveEvent, ClockEvent, DrawOfferEvent, TakebackOfferEvent, TakebackEvent, GameOverEvent, ServerErrorMessage,
]);

// Compile-time guard: the schema and the GameEvent type must describe the same thing,
// in both directions. If you change one without the other, tsc fails here.
const _schemaToType = (e: z.infer<typeof GameEventSchema>): GameEvent => e;
const _typeToSchema = (e: GameEvent): z.infer<typeof GameEventSchema> => e;
void _schemaToType;
void _typeToSchema;

export const UserEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("pairing_ready"),
    tournamentId: z.string(),
    gameId: z.string(),
    round: z.number().int().min(1),
  }),
  z.object({ type: z.literal("simul_invite"), simulId: z.string(), name: z.string(), hostName: z.string() }),
  z.object({ type: z.literal("simul_started"), simulId: z.string(), gameId: z.string() }),
]);

const _userSchemaToType = (e: z.infer<typeof UserEventSchema>): UserEvent => e;
const _userTypeToSchema = (e: UserEvent): z.infer<typeof UserEventSchema> => e;
void _userSchemaToType;
void _userTypeToSchema;

const simulId = z.string();

export const SimulEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("simul_board"), simulId, gameId, ply: z.number().int().min(0), turn: Color,
    fen: z.string(), lastMove: z.string().nullable(), status: z.enum(["started", "finished", "aborted"]),
    result: GameResult.optional(), termination: Termination.optional(),
    whiteMs: ms, blackMs: ms, deadlineAt: ms, drawOfferedBy: Color.nullable(),
  }),
  z.object({ type: z.literal("simul_state"), simulId, status: z.enum(["open", "running", "completed", "cancelled"]) }),
  z.object({ type: z.literal("simul_roster"), simulId }),
]);

const _simulSchemaToType = (e: z.infer<typeof SimulEventSchema>): SimulEvent => e;
const _simulTypeToSchema = (e: SimulEvent): z.infer<typeof SimulEventSchema> => e;
void _simulSchemaToType;
void _simulTypeToSchema;