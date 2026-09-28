import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendWebhook } from "./webhook.js";

describe("sendWebhook", () => {
  const originalUrl = process.env.WEBHOOK_URL;
  const originalKind = process.env.WEBHOOK_KIND;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalUrl === undefined) delete process.env.WEBHOOK_URL;
    else process.env.WEBHOOK_URL = originalUrl;
    if (originalKind === undefined) delete process.env.WEBHOOK_KIND;
    else process.env.WEBHOOK_KIND = originalKind;
  });

  it("does nothing when WEBHOOK_URL / WEBHOOK_KIND aren't set", async () => {
    delete process.env.WEBHOOK_URL;
    delete process.env.WEBHOOK_KIND;

    await sendWebhook("hello");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does nothing when only one of the two env vars is set", async () => {
    process.env.WEBHOOK_URL = "https://ntfy.sh/lilchess";
    delete process.env.WEBHOOK_KIND;

    await sendWebhook("hello");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts a plain-text body for ntfy", async () => {
    process.env.WEBHOOK_URL = "https://ntfy.sh/lilchess";
    process.env.WEBHOOK_KIND = "ntfy";

    await sendWebhook("game over");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://ntfy.sh/lilchess",
      expect.objectContaining({ method: "POST", body: "game over" }),
    );
  });

  it("posts a JSON content payload for discord", async () => {
    process.env.WEBHOOK_URL = "https://discord.com/api/webhooks/x/y";
    process.env.WEBHOOK_KIND = "discord";

    await sendWebhook("game over");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://discord.com/api/webhooks/x/y",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "game over" }),
      }),
    );
  });

  it("swallows fetch failures instead of throwing", async () => {
    process.env.WEBHOOK_URL = "https://ntfy.sh/lilchess";
    process.env.WEBHOOK_KIND = "ntfy";
    fetchMock.mockRejectedValue(new Error("network down"));

    await expect(sendWebhook("game over")).resolves.toBeUndefined();
  });
});