import { z } from "zod";
import { normalizeUsername } from "./auth/username.js";
import type { FastifyReply } from "fastify";

// ---- shared field rules ----
export const Id = z.string().regex(/^[0-9a-f]{8,16}$/i, "Invalid id");
export const Uci = z.string().regex(/^[a-h][1-8][a-h][1-8][qrbn]?$/, "Invalid move");
const Ply = z.number().int().min(0).max(10_000);

// ---- auth ----
// Registration is strict (ASCII only: the NOCASE collation only folds ASCII, and it blocks lookalike names).
export const RegisterBody = z.object({
  username: z.string().trim().regex(/^[A-Za-z0-9_-]{3,20}$/, "Username must be 3–20 letters, digits, _ or -"),
  password: z.string().min(8, "Password must be at least 8 characters").max(128, "Password must be at most 128 characters"),
  inviteCode: z.string().max(128).optional(),
});

// Login stays lax so accounts created before these rules still work.
export const LoginBody = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(128),
});

// ---- games ----
const Common = {
  colorPref: z.enum(["white", "black", "random"]).optional(),
  toUsername: z.string().trim().min(1).max(64).optional(),
};

export const ChallengeBody = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("live"),
    initialMs: z.number().int().min(10_000).max(3 * 60 * 60 * 1000),
    incrementMs: z.number().int().min(0).max(3 * 60 * 1000).default(0),
    ...Common,
  }),
  z.object({
    mode: z.literal("correspondence"),
    daysPerMove: z.number().int().min(1).max(30),
    ...Common,
  }),
]);
export type ChallengeInput = z.infer<typeof ChallengeBody>;

export const MoveBody = z.object({ ply: Ply, uci: Uci });
export const IdParams = z.object({ id: Id });
export const UsernameParams = z.object({ username: z.string().min(1).max(64) });

// ---- websocket ----
export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("move"), ply: Ply, uci: Uci }),
]);

// ---- helper ----
// Usage in a handler:
//   const body = parse(Schema, req.body, reply);
//   if (!body) return reply;
export function parse<T extends z.ZodType>(
  schema: T,
  data: unknown,
  reply: FastifyReply,
): z.infer<T> | undefined {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const where = issue && issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
  void reply.code(400).send({ error: `${where}${issue?.message ?? "Invalid request"}` });
  return undefined;
}