import type { z } from "zod";

export type Validated<T> = { ok: true; data: T } | { ok: false; error: string };

// Runs a shared schema and returns the first problem as a message fit for a form.
export function validate<S extends z.ZodType>(schema: S, input: unknown): Validated<z.output<S>> {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, error: result.error.issues[0]?.message ?? "Invalid input" };
}