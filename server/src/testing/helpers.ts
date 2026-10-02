import type { FastifyInstance } from "fastify";

/** Registers a user and returns their session cookie value. */
export async function registerUser(app: FastifyInstance, username: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/register",
    payload: { username, password: "hunter22!" },
  });
  const sid = res.cookies.find((c) => c.name === "sessionId")?.value;
  if (!sid) throw new Error(`register failed: ${res.body}`);
  return sid;
}

/** whiteSid plays white. Creates a challenge, has blackSid accept it, returns the game id. */
export async function startGame(
  app: FastifyInstance,
  whiteSid: string,
  blackSid: string,
  clock: Record<string, unknown> = { mode: "live", initialMs: 300_000, incrementMs: 0 },
): Promise<string> {
  const created = await app.inject({
    method: "POST",
    url: "/api/challenges",
    cookies: { sessionId: whiteSid },
    payload: { ...clock, colorPref: "white" },
  });
  if (created.statusCode !== 200) throw new Error(`challenge failed: ${created.body}`);

  const accepted = await app.inject({
    method: "POST",
    url: `/api/challenges/${created.json().challengeId}/accept`,
    cookies: { sessionId: blackSid },
  });
  if (accepted.statusCode !== 200) throw new Error(`accept failed: ${accepted.body}`);
  return accepted.json().gameId as string;
}