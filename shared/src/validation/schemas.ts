import { z } from "zod";
import { normalizeUsername } from "./username.js";
import { VARIANTS } from "../core/types.js";
import { NOTIFICATION_KINDS } from "./notifications.js";

export const Uci = z.string().regex(/^[a-h][1-8][a-h][1-8][qrbn]?$/, "Invalid move");
export const Ply = z.number().int().min(0).max(10_000);

const Password = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must be at most 128 characters");

export const Email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "Email is too long")
  .pipe(z.email("Enter a valid email address"));

// Registration is strict (ASCII only: NOCASE only folds ASCII, and it blocks lookalike names).
export const RegisterBody = z.object({
  username: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{3,20}$/, "Username must be 3–20 letters, digits, _ or -")
    .refine((n) => !/^guest[_-]/i.test(n), "That username is reserved")
    .transform(normalizeUsername),
  password: Password,
  inviteCode: z.string().max(128).optional(),
});

// Login stays lax so accounts created before these rules still work.
export const LoginBody = z.object({
  username: z.string().min(1, "Enter your username").max(64).transform(normalizeUsername),
  password: z.string().min(1, "Enter your password").max(128),
});

const Common = {
  colorPref: z.enum(["white", "black", "random"]).optional(),
  toUsername: z.string().trim().min(1).max(64).transform(normalizeUsername).optional(),
  link: z.boolean().optional(),
  rated: z.boolean().optional(),
  variant: z.enum(VARIANTS).optional(),
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

export const MoveBody = z.object({ ply: Ply, uci: Uci });

export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("move"), ply: Ply, uci: Uci }),
]);

// ---- email ----

// email: "" or null removes it; omitted leaves it alone. prefs: only the kinds you send change.
export const NotificationSettingsBody = z.object({
  email: z.union([z.literal(""), z.null(), Email]).optional(),
  prefs: z.partialRecord(z.enum(NOTIFICATION_KINDS), z.boolean()).optional(),
});

export const ForgotPasswordBody = z.object({
  identifier: z.string().trim().min(1, "Enter your username or email").max(254),
});

export const ResetPasswordBody = z.object({
  token: z.string().regex(/^[0-9a-f]{64}$/, "This reset link is invalid"),
  password: Password,
});

export const UnsubscribeBody = z.object({
  token: z.string().regex(/^[0-9a-f]{32}$/, "This link is invalid"),
});

// "path: message" for API error bodies.
export function describeIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  const where = issue && issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
  return `${where}${issue?.message ?? "Invalid request"}`;
}