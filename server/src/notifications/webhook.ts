type WebhookKind = "ntfy" | "discord";

import { logger } from "../logger.js";
const log = logger.child({ mod: "webhook" });

function config(): { url: string; kind: WebhookKind } | undefined {
  const url = process.env.WEBHOOK_URL;
  const configuredKind = process.env.WEBHOOK_KIND;
  if (!url) return undefined;

  let kind: WebhookKind | undefined;
  if (configuredKind === "ntfy" || configuredKind === "discord") {
    kind = configuredKind;
  } else if (!configuredKind) {
    try {
      const target = new URL(url);
      if (/^(?:[a-z]+\.)?(?:discord|discordapp)\.com$/.test(target.hostname) && target.pathname.startsWith("/api/webhooks/")) {
        kind = "discord";
      }
    } catch {
      return undefined;
    }
  }
  if (!kind) return undefined;
  return { url, kind };
}

export function webhookEnabled(): boolean {
  return config() !== undefined;
}

export async function sendWebhook(message: string, discordUserId?: string): Promise<void> {
  const cfg = config();
  if (!cfg) return;
  try {
    const content = discordUserId ? `<@${discordUserId}> ${message}` : message;
    const res = await fetch(cfg.url, {
      method: "POST",
      headers: cfg.kind === "discord" ? { "content-type": "application/json" } : undefined,
      body: cfg.kind === "discord"
        ? JSON.stringify({
            content,
            allowed_mentions: { parse: [], users: discordUserId ? [discordUserId] : [] },
          })
        : message,
      signal: AbortSignal.timeout(5_000), 
    });
    if (!res.ok) log.warn({ status: res.status, kind: cfg.kind }, "webhook returned non-2xx");
  } catch (err) {
    log.warn({ err, kind: cfg.kind }, "webhook failed");
  }
}