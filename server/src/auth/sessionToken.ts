export const SESSION_COOKIE = "sessionId";

export function sessionTokenFromCredentials(
  authorization: string | undefined,
  cookieToken: string | undefined,
): string | undefined {
  if (authorization === undefined) return cookieToken;
  return /^Bearer ([a-f0-9]{64})$/i.exec(authorization)?.[1];
}