import { scrypt, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

// Scrypt configuration
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

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
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [salt, key] = storedHash.split(':');
  if (!salt || !key) return false;

  const keyBuffer = Buffer.from(key, 'hex');
  const derivedKey = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  
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
 * We don't need scrypt here because the token is randomly generated with high entropy.
 */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}