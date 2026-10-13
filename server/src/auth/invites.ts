import { randomInt } from "node:crypto";
import { getDb } from "../db/connection.js";

// Registration invite codes handed out by admins when REGISTRATION=invite. No 0/O/1/I, so they survive being read aloud.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 12;

export type InviteStatus = "active" | "used up" | "expired" | "revoked";

export interface RegistrationInvite {
  code: string;
  note: string | null;
  createdBy: string | null; // username
  createdAt: number;
  expiresAt: number | null;
  maxUses: number;
  uses: number;
  revokedAt: number | null;
  status: InviteStatus;
}

export function generateInviteCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

/** People type codes with dashes and in any case; the stored form is plain upper case. */
export function normalizeInviteCode(input: string): string {
  return input.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

interface Row {
  code: string;
  note: string | null;
  created_by_name: string | null;
  created_at: number;
  expires_at: number | null;
  max_uses: number;
  uses: number;
  revoked_at: number | null;
}

function statusOf(r: Row, now: number): InviteStatus {
  if (r.revoked_at !== null) return "revoked";
  if (r.expires_at !== null && r.expires_at <= now) return "expired";
  if (r.uses >= r.max_uses) return "used up";
  return "active";
}

function toInvite(r: Row, now: number): RegistrationInvite {
  return {
    code: r.code,
    note: r.note,
    createdBy: r.created_by_name,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    maxUses: r.max_uses,
    uses: r.uses,
    revokedAt: r.revoked_at,
    status: statusOf(r, now),
  };
}

const SELECT = `
  SELECT i.code, i.note, u.username AS created_by_name, i.created_at, i.expires_at, i.max_uses, i.uses, i.revoked_at
  FROM registration_invites i LEFT JOIN users u ON u.id = i.created_by`;

export function createRegistrationInvite(
  createdBy: number,
  opts: { note: string | null; maxUses: number; expiresAt: number | null; now?: number },
): RegistrationInvite {
  const db = getDb();
  const now = opts.now ?? Date.now();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateInviteCode();
    try {
      db.prepare(`
        INSERT INTO registration_invites (code, note, created_by, created_at, expires_at, max_uses)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(code, opts.note, createdBy, now, opts.expiresAt, opts.maxUses);
      return toInvite(db.prepare(`${SELECT} WHERE i.code = ?`).get(code) as Row, now);
    } catch (err) {
      if ((err as { code?: string }).code !== "SQLITE_CONSTRAINT_PRIMARYKEY") throw err;
    }
  }
  throw new Error("could not allocate an invite code");
}

export function listRegistrationInvites(now = Date.now()): RegistrationInvite[] {
  const rows = getDb().prepare(`${SELECT} ORDER BY i.created_at DESC, i.rowid DESC LIMIT 500`).all() as Row[];
  return rows.map((r) => toInvite(r, now));
}

export function countActiveInvites(now = Date.now()): number {
  return getDb().prepare(`
    SELECT COUNT(*) FROM registration_invites
    WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?) AND uses < max_uses
  `).pluck().get(now) as number;
}

/** A cheap read so a bad code is turned away before any password hashing happens. */
export function isRegistrationInviteUsable(code: string, now = Date.now()): boolean {
  return getDb().prepare(`
    SELECT 1 FROM registration_invites
    WHERE code = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?) AND uses < max_uses
  `).get(normalizeInviteCode(code), now) !== undefined;
}

/** Uses one registration of the code. Atomic, so two sign-ups can't share the last use. */
export function consumeRegistrationInvite(code: string, now = Date.now()): boolean {
  return getDb().prepare(`
    UPDATE registration_invites SET uses = uses + 1
    WHERE code = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?) AND uses < max_uses
  `).run(normalizeInviteCode(code), now).changes === 1;
}

export function revokeRegistrationInvite(code: string, now = Date.now()): "revoked" | "already_revoked" | "not_found" {
  const db = getDb();
  const normalized = normalizeInviteCode(code);
  const changed = db.prepare(`UPDATE registration_invites SET revoked_at = ? WHERE code = ? AND revoked_at IS NULL`).run(now, normalized).changes;
  if (changed === 1) return "revoked";
  return db.prepare(`SELECT 1 FROM registration_invites WHERE code = ?`).get(normalized) ? "already_revoked" : "not_found";
}