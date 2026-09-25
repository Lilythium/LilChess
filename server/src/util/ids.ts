import { randomBytes } from "node:crypto";

export function shortId(): string {
  return randomBytes(9).toString("base64url"); // 12 url-safe chars
}