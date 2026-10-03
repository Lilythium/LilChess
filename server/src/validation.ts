import { z } from "zod";
import type { FastifyReply } from "fastify";
import { ChallengeBody, describeIssue, normalizeUsername } from "@lilchess/shared";

// The request/message schemas live in @lilchess/shared so the browser validates with the same rules.
export { ChallengeBody, ClientMessageSchema, LoginBody, MoveBody, RegisterBody, Uci } from "@lilchess/shared";
export type ChallengeInput = z.infer<typeof ChallengeBody>;

// ---- server-only ----
export const Id = z.string().regex(/^[0-9a-f]{8,16}$/i, "Invalid id");
export const IdParams = z.object({ id: Id });
export const UsernameParams = z.object({ username: z.string().min(1).max(64).transform(normalizeUsername) });

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
  void reply.code(400).send({ error: describeIssue(result.error) });
  return undefined;
}