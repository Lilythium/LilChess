import { scrypt, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

// Pre-computed dummy salt (16 bytes hex = 32 chars) and dummy hash (64 bytes hex = 128 chars)
// Used when verifying password for non-existent users to maintain constant-time execution.
const DUMMY_SALT = '00'.repeat(SALT_LENGTH);
const DUMMY_KEY_HEX = '00'.repeat(KEY_LENGTH);
const DUMMY_STORED_HASH = `${DUMMY_SALT}:${DUMMY_KEY_HEX}`;

/**
 * Hashes a plaintext password using scrypt.
 * Returns a formatted string: "salt:hash" (hex encoded)
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH).toString('hex');
  const derivedKey = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  return `${salt}:${derivedKey.toString('hex')}`;
}

/**
 * Verifies a plaintext password against a stored "salt:hash" string.
 * Exception-safe and safe against length-mismatch throws in timingSafeEqual.
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [salt, key] = storedHash.split(':');
  if (!salt || !key) return false;

  const keyBuffer = Buffer.from(key, 'hex');
  const derivedKey = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;

  if (keyBuffer.length !== derivedKey.length) return false;
  return timingSafeEqual(keyBuffer, derivedKey);
}

/**
 * Generates a random 32-byte session token (sent to client in a cookie).
 */
export function generateSessionToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Hashes the session token using fast SHA-256 (stored in the database).
 */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

let dummyHash: Promise<string> | undefined;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword(randomBytes(8).toString('hex'));
  await verifyPassword(password, await dummyHash);
}

export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}