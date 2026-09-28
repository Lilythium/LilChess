type WebhookKind = "ntfy" | "discord";

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
    await fetch(cfg.url, {
      method: "POST",
      headers: cfg.kind === "discord" ? { "content-type": "application/json" } : undefined,
      body: cfg.kind === "discord" ? JSON.stringify({ content: message }) : message,
    });
  } catch {
    // notifications are non-critical
  }
}