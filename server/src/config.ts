import { z } from "zod";

const Env = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default("0.0.0.0"),
  DATA_DIR: z.string().default("./data"),
  REGISTRATION: z.enum(["open", "invite", "closed"]).default("open"),
  INVITE_CODE: z.string().optional(),
  ADMIN_USERNAME: z.string().trim().min(1).optional(),
  // Only used to create the first administrator when that account doesn't exist yet (see auth/bootstrap.ts).
  ADMIN_PASSWORD: z.string().min(8, "must be at least 8 characters").max(128).optional(),
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
  // Optional: a Discord channel webhook. Users who give their Discord ID get notifications as @mentions there.
  DISCORD_WEBHOOK_URL: z.string().optional(),
  // Optional: verified https links (Android App Links, iOS universal links) into the LilChess mobile app.
  // Leave empty to keep the /.well-known association files off. See docs/mobile-phase-7-platform.md.
  MOBILE_ANDROID_PACKAGE: z.string().default("io.github.lilythium.lilchess"),
  MOBILE_ANDROID_CERT_SHA256: z.string().optional(), // comma-separated signing-certificate SHA-256 fingerprints
  MOBILE_IOS_APP_ID: z.string().optional(), // comma-separated "TEAMID.bundle.id" values
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
  adminUsername: string | undefined;
  adminPassword: string | undefined;
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
  discordWebhookUrl: string | undefined;
  mobile: MobileLinkConfig;
}

export interface MobileLinkConfig {
  androidPackage: string;
  /** Upper-case, colon-separated SHA-256 fingerprints of the app signing certificate(s). */
  androidCertSha256: string[];
  /** Apple app ids: `<TeamID>.<bundle id>`. */
  iosAppIds: string[];
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

  if (e.ADMIN_PASSWORD && !e.ADMIN_USERNAME) {
    throw new Error("Invalid configuration:\n  ADMIN_PASSWORD: needs ADMIN_USERNAME as well");
  }

  const baseOrigin = e.BASE_URL ? new URL(e.BASE_URL).origin : undefined;

  if (e.SMTP_HOST) {
    const problems: string[] = [];
    if (!e.SMTP_FROM) problems.push("SMTP_FROM: required when SMTP_HOST is set");
    if (!baseOrigin) problems.push("BASE_URL: required when SMTP_HOST is set (emails contain links)");
    if (Boolean(e.SMTP_USER) !== Boolean(e.SMTP_PASS)) problems.push("SMTP_USER / SMTP_PASS: set both or neither");
    if (problems.length > 0) throw new Error(`Invalid configuration:\n  ${problems.join("\n  ")}`);
  }
  if (e.DISCORD_WEBHOOK_URL) {
    const problems: string[] = [];
    if (!isDiscordWebhook(e.DISCORD_WEBHOOK_URL)) problems.push("DISCORD_WEBHOOK_URL: must be a https://discord.com/api/webhooks/... URL");
    if (!baseOrigin) problems.push("BASE_URL: required when DISCORD_WEBHOOK_URL is set (messages contain links)");
    if (problems.length > 0) throw new Error(`Invalid configuration:\n  ${problems.join("\n  ")}`);
  }
  const mobile = parseMobileLinks(e);
  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    host: e.HOST,
    dataDir: e.DATA_DIR,
    registration: e.REGISTRATION,
    inviteCode: e.INVITE_CODE,
    adminUsername: e.ADMIN_USERNAME,
    adminPassword: e.ADMIN_PASSWORD,
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
    discordWebhookUrl: e.DISCORD_WEBHOOK_URL || undefined,
    mobile,
  };
}

const SHA256_FINGERPRINT = /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/;
const ANDROID_PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/;
const IOS_APP_ID = /^[A-Z0-9]{10}\.[A-Za-z0-9][A-Za-z0-9.-]*$/;

function splitList(raw: string | undefined): string[] {
  return (raw ?? "").split(",").map((v) => v.trim()).filter(Boolean);
}

function parseMobileLinks(e: z.infer<typeof Env>): MobileLinkConfig {
  const androidCertSha256 = splitList(e.MOBILE_ANDROID_CERT_SHA256).map((v) => v.toUpperCase());
  const iosAppIds = splitList(e.MOBILE_IOS_APP_ID);
  const problems: string[] = [];
  if (!ANDROID_PACKAGE.test(e.MOBILE_ANDROID_PACKAGE)) problems.push("MOBILE_ANDROID_PACKAGE: must be an Android package name such as io.github.lilythium.lilchess");
  if (androidCertSha256.some((v) => !SHA256_FINGERPRINT.test(v))) {
    problems.push("MOBILE_ANDROID_CERT_SHA256: each value must be 32 colon-separated hex bytes (AA:BB:...:FF)");
  }
  if (iosAppIds.some((v) => !IOS_APP_ID.test(v))) {
    problems.push("MOBILE_IOS_APP_ID: each value must look like ABCDE12345.io.github.lilythium.lilchess");
  }
  if (problems.length > 0) throw new Error(`Invalid configuration:\n  ${problems.join("\n  ")}`);
  return { androidPackage: e.MOBILE_ANDROID_PACKAGE, androidCertSha256, iosAppIds };
}

function isDiscordWebhook(raw: string): boolean {
  try {
    const u = new URL(raw);
    const hostOk = /^(?:[a-z]+\.)?(?:discord|discordapp)\.com$/.test(u.hostname);
    return u.protocol === "https:" && hostOk && u.pathname.startsWith("/api/webhooks/");
  } catch {
    return false;
  }
}

export const config: Config = loadConfig(
  process.env.VITEST ? { ...process.env, BASE_URL: undefined, SMTP_HOST: undefined, DISCORD_WEBHOOK_URL: undefined } : process.env,
);