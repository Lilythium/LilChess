import { config } from "../config.js";
import { logger } from "../logger.js";

const log = logger.child({ mod: "discord" });

export const DISCORD_ID = /^\d{17,20}$/;
const MAX_CONTENT = 1900; // Discord's limit is 2000

export function discordEnabled(): boolean {
  return config.discordWebhookUrl !== undefined;
}

/**
 * Posts "@user subject / text" to the server's Discord webhook. Never throws: a Discord outage must not
 * break a move or a challenge. `allowed_mentions` pings only this user, so a tournament called
 * "@everyone" can't mention anyone else. Returns whether Discord accepted the message.
 */
export async function sendDiscord(discordId: string, subject: string, text: string): Promise<boolean> {
  const url = config.discordWebhookUrl;
  if (!url) return false;
  const body = `<@${discordId}> **${subject}**\n${text}`.trim();
  const content = body.length > MAX_CONTENT ? `${body.slice(0, MAX_CONTENT - 1)}…` : body;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content, allowed_mentions: { users: [discordId] } }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) log.warn({ status: res.status }, "discord webhook returned non-2xx");
    return res.ok;
  } catch (err) {
    log.warn({ err }, "discord webhook failed");
    return false;
  }
}
