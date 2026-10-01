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
});

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
  };
}

export const config: Config = loadConfig(
  process.env.VITEST ? { ...process.env, BASE_URL: undefined } : process.env,
);