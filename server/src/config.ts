import { z } from "zod";

const Env = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default("0.0.0.0"),
  DATA_DIR: z.string().default("./data"),
  REGISTRATION: z.enum(["open", "invite", "closed"]).default("open"),
  INVITE_CODE: z.string().optional(),
  BASE_URL: z
    .url({
      protocol: /^https?$/, // matched without the colon
      error: "must be an absolute http(s) URL, e.g. https://chess.example.com",
    })
    .optional(),
  TRUST_PROXY: z.string().optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  BACKUP_DIR: z.string().optional(),
  BACKUP_KEEP: z.coerce.number().int().min(0).max(365).default(7), // 0 disables backups
  BACKUP_HOUR_UTC: z.coerce.number().int().min(0).max(23).default(3),
  ALLOW_GUESTS: z.stringbool().default(true),
  LEADERBOARD_MIN_GAMES: z.coerce.number().int().min(0).max(1000).default(5),
  LEADERBOARD_INACTIVE_DAYS: z.coerce.number().int().min(0).max(3650).default(30), // 0 = never hide inactive players
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: z.stringbool().default(false), // true for implicit TLS (port 465)
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
});

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string | undefined;
  pass: string | undefined;
  from: string;
}

export interface Config {
  nodeEnv: string;
  port: number;
  host: string;
  dataDir: string;
  registration: "open" | "invite" | "closed";
  inviteCode: string | undefined;
  baseOrigin: string | undefined;
  cookieSecure: boolean;
  trustProxy: boolean | number | string;
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
  backupDir: string;
  backupKeep: number;
  backupHourUtc: number;
  allowGuests: boolean;
  leaderboardMinGames: number;
  leaderboardInactiveDays: number;
  smtp: SmtpConfig | undefined;
}

function parseTrustProxy(v: string | undefined): boolean | number | string {
  if (!v || v === "false") return false;
  if (v === "true") return true;
  if (/^\d+$/.test(v)) return Number(v);
  return v; // comma-separated IPs / CIDRs
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ""));
  const parsed = Env.safeParse(cleaned);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".") || "(env)"}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${lines.join("\n")}`);
  }
  const e = parsed.data;
  if (e.REGISTRATION === "invite" && !e.INVITE_CODE) {
    throw new Error("Invalid configuration:\n  INVITE_CODE: required when REGISTRATION=invite");
  }

  const baseOrigin = e.BASE_URL ? new URL(e.BASE_URL).origin : undefined;

  if (e.SMTP_HOST) {
    const problems: string[] = [];
    if (!e.SMTP_FROM) problems.push("SMTP_FROM: required when SMTP_HOST is set");
    if (!baseOrigin) problems.push("BASE_URL: required when SMTP_HOST is set (emails contain links)");
    if (Boolean(e.SMTP_USER) !== Boolean(e.SMTP_PASS)) problems.push("SMTP_USER / SMTP_PASS: set both or neither");
    if (problems.length > 0) throw new Error(`Invalid configuration:\n  ${problems.join("\n  ")}`);
  }
  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    host: e.HOST,
    dataDir: e.DATA_DIR,
    registration: e.REGISTRATION,
    inviteCode: e.INVITE_CODE,
    baseOrigin,
    // Secure cookies need HTTPS. Follow BASE_URL when given; otherwise fall back to NODE_ENV.
    cookieSecure: baseOrigin ? baseOrigin.startsWith("https://") : e.NODE_ENV === "production",
    trustProxy: parseTrustProxy(e.TRUST_PROXY),
    logLevel: e.LOG_LEVEL,
    backupDir: e.BACKUP_DIR ?? `${e.DATA_DIR}/backups`,
    backupKeep: e.BACKUP_KEEP,
    backupHourUtc: e.BACKUP_HOUR_UTC,
    allowGuests: e.ALLOW_GUESTS,
    leaderboardMinGames: e.LEADERBOARD_MIN_GAMES,
    leaderboardInactiveDays: e.LEADERBOARD_INACTIVE_DAYS,
    smtp: e.SMTP_HOST ? {
      host: e.SMTP_HOST ?? "localhost",
      port: e.SMTP_PORT,
      secure: e.SMTP_SECURE,
      user: e.SMTP_USER,
      pass: e.SMTP_PASS,
      from: e.SMTP_FROM ?? "noreply@example.com",
    } : undefined,
  };
}

export const config: Config = loadConfig(
  process.env.VITEST ? { ...process.env, BASE_URL: undefined, SMTP_HOST: undefined } : process.env,
);