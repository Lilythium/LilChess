type WebhookKind = "ntfy" | "discord";

import { logger } from "../logger.js";
const log = logger.child({ mod: "webhook" });

function config(): { url: string; kind: WebhookKind } | undefined {
  const url = process.env.WEBHOOK_URL;
  const kind = process.env.WEBHOOK_KIND as WebhookKind | undefined;
  if (!url || !kind) return undefined;
  return { url, kind };
}

export async function sendWebhook(message: string): Promise<void> {
  const cfg = config();
  if (!cfg) return;
  try {
    const res = await fetch(cfg.url, {
      method: "POST",
      headers: cfg.kind === "discord" ? { "content-type": "application/json" } : undefined,
      body: cfg.kind === "discord" ? JSON.stringify({ content: message }) : message,
      signal: AbortSignal.timeout(5_000), 
    });
    if (!res.ok) log.warn({ status: res.status, kind: cfg.kind }, "webhook returned non-2xx");
  } catch (err) {
    log.warn({ err, kind: cfg.kind }, "webhook failed");
  }
}